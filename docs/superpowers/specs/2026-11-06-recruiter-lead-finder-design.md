# Recruiter Lead Finder Design

## Intent

Add a dedicated **Lead Finder** module that turns natural-language recruiter search requests into reviewable email leads, then saves selected leads as a normal recipient group for outreach. This is a core BD capability for Outreach Studio: find talent-acquisition contacts via public web search, keep a human in the loop, and reuse existing Recipients / Recipient Groups / Compose flows.

## Decisions (locked)

| Topic | Choice |
|---|---|
| Audience | Recruiters / talent acquisition only (v1) |
| Data source | Public web search APIs (Serper or Google Custom Search) → fetch public pages → extract |
| Save flow | Human review table first, then user saves group |
| Consent | No consent gate in product flow (UI already removed; do not reintroduce for this module) |
| Input | Natural-language chat (dynamic lead count in the instruction or UI) |
| Product surface | New sidebar page **Lead Finder** (`/lead-finder`); AI Agent Studio unchanged |
| Valid lead | Email required **and** at least name **or** company |
| Execution | Hybrid batches: POST returns immediately + Celery; first batch ~20 preview, then continue toward target |
| Engine style | Deterministic pipeline + LLM only at edges (brief parse / light normalize) — not a free tool-loop agent |

## Goals

- User asks in chat, e.g. “Find 40 technical recruiters at fintech startups in London.”
- System returns a reviewable candidate table with source URLs.
- User selects/edits candidates and saves a named recipient group.
- Existing org emails are reused (no duplicate recipients); new emails create recipients.
- Runs are durable, progress-visible, and recoverable after navigation.

## Non-goals (v1)

- LinkedIn login, browser automation, or ToS-violating scrape of authenticated networks
- Paid enrichment providers (Hunter, Apollo, Clearbit, etc.)
- Auto-creating or sending campaigns
- SMTP / mailbox verification of addresses
- Replacing AI Agent Studio agents (compose, document, planning, delivery, analytics)
- Inventing emails the page/search text did not contain

## Architecture

```text
User chat (Lead Finder page)
        ↓
Brief parser (LLM → structured schema)
        ↓
LeadSearchRun row (queued | running | ready | failed | cancelled)
        ↓
Pipeline (Celery worker; optional in-process fallback only for local dev):
  1. Build recruiter-biased search queries from brief
  2. Call web search provider
  3. Fetch public page HTML/text for top results
  4. Extract emails + nearby name/company/title signals
  5. Quality filter (email + name|company; title heuristics; junk mailboxes)
  6. Dedupe within run + against org recipients / suppression
        ↓
LeadCandidate rows → Review UI
        ↓
POST save-group → Recipients + RecipientGroup + GroupMembers
```

**Why this shape:** Matches Outreach Studio’s existing pattern of bounded intelligence (LangGraph nodes today never get arbitrary tools). Search and fetch are explicit services; the LLM does not freely decide unbounded tool calls. Cost, tests, and failure modes stay controllable for a module that is “the heart” of BD workflow.

### Provider abstraction

- Config: `LEAD_SEARCH_PROVIDER` (`serper` | `google_cse`), provider API key(s), optional CSE engine id.
- One internal interface: `search(query, num) -> list[{title, url, snippet}]`.
- Page fetch is a separate HTTP client with timeouts, size limits, and skip-on-failure.
- Missing provider key → run fails with an actionable configuration error (same product language as missing Groq/Gemini keys).

### Hybrid execution

- User-specified `target_count` (from chat or UI), capped by `LEAD_FINDER_MAX_PER_RUN` (default **100**).
- **HTTP never blocks on the full pipeline:** `POST /lead-finder/runs` and `continue` create/update the run, enqueue Celery, and return the run id immediately. The UI polls status and candidates.
- **Hybrid = batch sizing, not dual engines:** first batch aims for a quick preview (default first-batch budget aligned to ~20 candidates or a small page/query cap). Further pages/queries run until `target_count` or budget exhaustion; `continue` expands the budget.
- If Celery/Redis is unavailable in local dev, a documented inline fallback may run the same pipeline function in-process after create — production path is always Celery.
- Progress fields on the run: queries done, pages fetched, candidates kept, status message.

## Data model

### `LeadSearchRun`

- `id`, `organization_id`, `created_by_user_id`
- `instruction` (raw chat text)
- `brief` (JSON: roles, location, keywords, industry, target_count, exclusions)
- `status`: `queued` | `running` | `ready` | `failed` | `cancelled`
- `target_count`, `progress` (JSON), `error` (nullable)
- `created_at`, `updated_at`

### `LeadCandidate`

- `id`, `run_id`, `organization_id`
- `email`, `name`, `company`, `position`
- `source_url`, `source_title` (optional), `snippet` (optional)
- `score` / `signals` (JSON; title match, junk flags)
- `selected` (bool; default true only if quality gate + title heuristic pass)
- `existing_recipient_id` (nullable; set when email already in org)
- Unique per run on normalized email

Save writes into existing `recipients`, `recipient_groups`, `recipient_group_members`. Store `source_url` in recipient `custom_fields` (e.g. `lead_source_url`) for audit/personalization. Do not invent a new consent requirement for this path.

## API

All routes tenant-scoped; editor (or equivalent write) role for mutate; viewer can read if that matches existing resource patterns.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/lead-finder/runs` | Parse instruction, create run, start pipeline |
| `GET` | `/lead-finder/runs` | Recent runs for the org |
| `GET` | `/lead-finder/runs/{id}` | Status, brief, progress |
| `GET` | `/lead-finder/runs/{id}/candidates` | Review rows (paginated if needed) |
| `PATCH` | `/lead-finder/runs/{id}/candidates/{id}` | Edit fields / toggle `selected` |
| `POST` | `/lead-finder/runs/{id}/continue` | Find more toward target (Celery) |
| `POST` | `/lead-finder/runs/{id}/cancel` | Cancel running job; keep partial candidates |
| `POST` | `/lead-finder/runs/{id}/save-group` | `{ group_name, candidate_ids? }` |

### `save-group` behavior

1. Use selected candidates, or explicit `candidate_ids` if provided.
2. Reject with 422 if none selected.
3. For each email: if active recipient exists in org → reuse; else create recipient with name/company/position/custom source URL.
4. Create recipient group with unique name (409 on duplicate name, same as today).
5. Add memberships; return `{ group_id, group_name, created, reused, skipped }` and link-friendly ids.
6. Audit events consistent with existing recipient/group audits.

## UI

- Sidebar nav item: **Lead Finder** (alongside AI Agent Studio; Studio keeps its current role).
- Layout:
  - Chat / instruction composer with optional numeric target override.
  - Active run status + progress.
  - Candidate review table: select, email, name, company, position, source link, inline edit.
  - Actions: select-all quality, clear junk, Find more, Save as recipient group (name dialog).
  - Recent runs list to reopen a ready/partial run.
- Empty / error / loading states follow existing workspace patterns.
- After save: toast + links to Recipient Groups and Compose.

## Pipeline quality rules

- **Keep** only candidates with a parseable email and (non-empty name or company).
- **Hard-reject** mailbox patterns: `noreply@`, `donotreply@`, `no-reply@`, `mailer-daemon@`.
- **Soft-downrank / default deselect**: `info@`, `careers@`, `jobs@`, `hr@` when no person name is attached; still visible in the table.
- **Title heuristic (select by default):** recruiter, talent acquisition, talent partner, TA, hiring manager, people operations / people ops (when clearly recruiting-related). Low/unknown titles default unselected.
- **Never invent** emails or people; extraction only from search snippets and fetched page text. LLM normalize may clean name/company strings already present — it must not fabricate addresses.
- Dedupe case-insensitive email within run; mark existing org recipients; respect suppression list (do not offer suppressed emails as selected).

## Errors

| Situation | Behavior |
|---|---|
| Missing search API key | Run `failed`; message tells operator which env var to set |
| Provider rate limit / timeout | Limited retries; then partial `ready` with warning or `failed` if zero work done |
| Single page fetch failure | Skip URL; continue run |
| Zero quality candidates | `ready`, empty table, tip to broaden query |
| Duplicate group name on save | 409 |
| Save with empty selection | 422 |
| Cancel | `cancelled`; partial candidates remain reviewable |

## Configuration defaults

- `LEAD_FINDER_MAX_PER_RUN=100`
- First-batch preview budget ≈ `20` candidates (then poll; use Find more / continue toward full target)
- Search result pages fetched per query: small fixed budget, expanded on `continue`
- Fetch timeout and max body size enforced server-side

## Testing

- Unit: brief schema parsing; email extraction; junk filters; title heuristics; dedupe; cap enforcement.
- API: mocked search + fetch → candidates → patch → save-group creates/reuses recipients and group.
- Worker: large-run Celery path updates progress and reaches `ready` / `failed`.
- Regression: AI Agent Studio and existing recipient-group APIs unchanged.

## Implementation notes (boundaries)

- Prefer new packages under something like `backend/app/lead_finder/` (search client, extract, pipeline, schemas) rather than overloading `agents/orchestrator.py` with web-fetch side effects.
- Reuse Celery app, tenant `owned()` helpers, recipient/group services, and audit helpers.
- Frontend: new page + service module; nav entry in workspace layout.
- Document required env keys in README / setup alongside existing AI provider config.

## Success criteria

- From a single NL request, a user can review real extracted recruiter emails (with sources) and save a usable recipient group without leaving Lead Finder except for optional Compose.
- No fabricated emails in candidates.
- Small and large target counts both complete without hanging the browser request indefinitely.
- Studio’s existing agents remain approval-bounded and unchanged in responsibility.
