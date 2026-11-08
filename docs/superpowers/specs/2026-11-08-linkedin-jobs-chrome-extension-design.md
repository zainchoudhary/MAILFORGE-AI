# LinkedIn Jobs Chrome Extension Design

## Intent

Add a **standalone Chrome MV3 extension** that captures LinkedIn Jobs search results from the user’s authenticated browser session, stores raw job data in the Outreach Studio database, optionally enriches contacts via the existing public-web Lead Finder–style pipeline, and lets users save email leads as normal **Recipient Groups** (same pattern as Gmail / Lead Finder search). The placeholder **LinkedIn Search** workspace page becomes the primary review surface; the extension provides capture controls and lightweight on-page feedback.

This is **user-assisted capture** of pages the user can already view while logged into LinkedIn—not a server-side LinkedIn crawl using stored cookies.

## Decisions (locked)

| Topic | Choice |
|---|---|
| Outcome | Raw jobs first, then optional contact enrichment, then Recipient Groups + dual UI |
| Surfaces | Extension side panel (capture / progress / chips) + Studio LinkedIn Search (full review / save group) |
| Capture strategy | Hybrid: incremental default; optional rate-limited **Deep capture** for large result sets (~300) |
| Detail depth | List sync first; **on-demand** job detail scrape for selected/queued jobs |
| Contact emails | Show LinkedIn-derived signals first; **Find contacts** optionally runs public-web enrichment |
| Auth | Sign in with Outreach Studio: browser login → short-lived extension API token (no LinkedIn secrets on server) |
| “Group” meaning | Existing **Recipient Groups** from email leads (not a separate job-folder product) |
| Architecture | Thin extension + thick Outreach backend (Approach 1) |
| LinkedIn access | No server-side LinkedIn login, cookies, or Playwright against LinkedIn |

## Goals

- User installs the extension, signs into Outreach Studio, opens a LinkedIn Jobs search, and captures list results into a durable run in the shared DB.
- Deep capture can walk pagination/scroll under user control with progress (e.g. 47/300) and stop conditions.
- Selected jobs can fetch detail payloads on demand; selected jobs can trigger Find contacts.
- User reviews candidates and saves a named Recipient Group for Compose / Campaigns.
- Org isolation matches existing account ownership (`organization_id` / authenticated identity).

## Non-goals (v1)

- Public Chrome Web Store / Edge distribution (private / unpacked first)
- Server-side LinkedIn session reuse or headless LinkedIn scraping
- LinkedIn People / profile scraping (Jobs only)
- Auto-creating or sending campaigns
- Inventing emails not found in LinkedIn raw text or public pages
- A separate user-facing “job folder” product (jobs are intermediate capture rows)
- Replacing the existing Gmail / public-web Lead Finder module

## Architecture

```text
LinkedIn Jobs (user logged in)
        ↓
Chrome MV3 extension
  • content script: list / deep / detail capture
  • side panel: auth, progress, selection, Find contacts
  • background: token storage, batch upload queue, retry
        ↓
Outreach Studio API (same backend + DB)
  • LinkedInCaptureRun
  • LinkedInJobRaw
        ↓
Optional enrichment (user-triggered, Celery)
  • reuse Lead Finder–style public web search + page extract
  • LinkedInLeadCandidate (email + name|company)
        ↓
Review (Studio LinkedIn Search primary; extension chips secondary)
        ↓
Save → Recipients + RecipientGroup + GroupMembers
```

**Why this shape:** Matches Lead Finder’s durable run → review → save-group pattern. The extension only solves LinkedIn DOM access in the user’s browser; enrichment, ownership, and outreach stay in the existing backend.

## Components

### Extension package (`extension/`)

- Manifest V3 with host permissions limited to LinkedIn Jobs URLs needed for capture.
- Content script parses job list cards; Deep capture performs controlled pagination/scroll with delays; detail mode opens/reads job detail DOM for requested IDs.
- Side panel: Sign in, start/stop capture, progress, job selection, Fetch details, Find contacts, deep-link to Studio run.
- Service worker: auth token, outbound batch queue, retries on network failure.

### Backend

- New module area (e.g. `backend/app/linkedin_capture/`) for schemas, upsert, enrichment orchestration—do not overload `agents/orchestrator.py`.
- Reuse Celery, tenant `owned()` helpers, recipient/group save patterns, and Lead Finder search/fetch/extract where practical.
- Auth endpoints suitable for extension OAuth/device-code or session exchange; tokens org- and user-scoped.

### Frontend

- Replace `LinkedInFinder.jsx` placeholder with runs list, jobs table, candidates review, save-group dialog (mirror Lead Finder UX).
- Nav entry already exists: `/lead-finder/linkedin`.

## Data model

### `LinkedInCaptureRun`

- `id`, `organization_id`, `created_by_user_id`
- `search_url`, `search_query_snapshot` (nullable text)
- `status`: `capturing` | `idle` | `enriching` | `ready` | `failed` | `cancelled`
- `progress` (JSON: listed, detailed, candidates, message)
- `error` (nullable)
- `created_at`, `updated_at`

### `LinkedInJobRaw`

- `id`, `run_id`, `organization_id`
- `linkedin_job_id` (or canonical job URL key)
- `title`, `company`, `location`, `job_url`
- `list_payload` (JSON / text from list card)
- `detail_payload` (nullable; full description / raw extract)
- `detail_status`: `pending` | `fetched` | `failed` | `skipped`
- Unique on `(run_id, linkedin_job_id)` (fallback key: canonical `job_url`). Cross-run dedupe is advisory only (UI may hint “seen in earlier run”); it does not block upsert.

### `LinkedInLeadCandidate`

- Same quality bar as Lead Finder: parseable **email** and (**name** or **company**)
- `run_id`, `organization_id`, optional `job_raw_id`
- `email`, `name`, `company`, `position`
- `source_url`, `snippet`, `signals` (JSON), `selected`
- `existing_recipient_id` (nullable)
- Unique per run on normalized email
- Never invent addresses

Save-group writes into existing `recipients`, `recipient_groups`, `recipient_group_members` (same behavior as Lead Finder `save-group`).

## API (sketch)

All routes tenant-scoped; write roles for mutate.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/linkedin-capture/runs` | Create run (from extension or Studio) |
| `GET` | `/linkedin-capture/runs` | List recent runs |
| `GET` | `/linkedin-capture/runs/{id}` | Status + progress |
| `POST` | `/linkedin-capture/runs/{id}/jobs/batch` | Upsert list (and optional detail) payloads |
| `POST` | `/linkedin-capture/runs/{id}/jobs/fetch-details` | Queue/ack detail requests for job ids |
| `POST` | `/linkedin-capture/runs/{id}/enrich` | Start Find contacts (Celery) |
| `GET` | `/linkedin-capture/runs/{id}/jobs` | Paginated raw jobs |
| `GET` | `/linkedin-capture/runs/{id}/candidates` | Review rows |
| `PATCH` | `/linkedin-capture/runs/{id}/candidates/{id}` | Edit / toggle selected |
| `POST` | `/linkedin-capture/runs/{id}/save-group` | `{ group_name, candidate_ids? }` |
| `POST` | `/linkedin-capture/runs/{id}/cancel` | Stop enrichment / mark cancelled |

Exact path prefix may align with `/api/v1/...` conventions already used by the app.

Extension auth: dedicated token exchange compatible with MV3 (no long-lived LinkedIn secrets on server).

## User / data flow

1. Install extension → Sign in with Outreach Studio.
2. Open LinkedIn Jobs search → **Capture** (incremental sync of visible/loaded cards).
3. Batches upsert into `LinkedInCaptureRun` + `LinkedInJobRaw`.
4. Optional **Deep capture** for large sets (rate-limited); user can Stop; CAPTCHA/challenge aborts gracefully.
5. Select jobs → **Fetch details** → update `detail_payload`.
6. Select jobs → **Find contacts** → enrichment pipeline → `LinkedInLeadCandidate`.
7. Review in Studio (primary) / chips in extension (secondary).
8. **Save as Recipient Group** → Compose / Campaigns.

**Sync rule:** Backend is source of truth; extension refreshes state from API.

## Errors, limits, resilience

| Situation | Behavior |
|---|---|
| DOM / selector drift | Soft fail; keep partial batch; show “selectors outdated” |
| Deep capture interrupted | Stop; partial jobs remain |
| Upload failure | Local queue retry; no silent drop |
| Auth expired | Block capture; prompt re-login |
| Enrichment finds no email | Skip candidate; job remains; run can still be `ready` |
| Missing search provider key | Enrichment fails with actionable config error |
| Duplicate group name | 409 |
| Empty save selection | 422 |
| Per-run cap | Configurable (default target band **300–500** jobs); batch size + inter-page delay enforced |

Safety posture:

- Capture only when user starts it; no idle background LinkedIn crawling.
- Never send LinkedIn cookies to the Outreach server.
- Enforce raw payload size limits; runs/jobs deletable with normal org data ownership.

## UI

### Extension

- Side panel: account, run status, counts, Capture / Deep capture / Stop, selection actions, Find contacts, “Open in Outreach Studio”.
- Optional lightweight chips near job cards when enrichment exists (email/contact hint)—not a full CRM UI.

### Studio LinkedIn Search

- Recent runs, progress, jobs table, candidates table, save-group dialog.
- Empty state explains: install extension → capture from LinkedIn Jobs.
- After save: toast + links to Recipient Groups and Compose (Lead Finder pattern).

## Configuration defaults

- `LINKEDIN_CAPTURE_MAX_JOBS_PER_RUN` default **300** (hard ceiling ≤ **500**)
- Batch upload size and deep-capture delay tunable
- Reuse Lead Finder provider env keys for enrichment (`LEAD_SEARCH_PROVIDER`, etc.)
- Extension API base URL configurable for local vs production

## Testing

- Backend unit/API: batch upsert + dedupe, org isolation, enrich → candidates, save-group create/reuse recipients.
- Extension unit: fixture HTML for list + detail parsers; deep-capture stop conditions.
- Frontend: LinkedIn Search smoke (runs / candidates / save-group).
- Manual smoke: one real LinkedIn Jobs search + deep capture in dev (not CI).
- Regression: existing Lead Finder and recipient-group APIs unchanged.

## Implementation notes (boundaries)

- Prefer `extension/` at repo root (or `apps/linkedin-extension/`) as a separate package with its own build; do not bundle into the Vite app as a content script.
- Prefer `backend/app/linkedin_capture/` (+ thin API router) rather than growing `lead_finder/` with LinkedIn DOM concerns.
- Enrichment should call shared extract/search helpers where possible, keyed off company/job signals from `LinkedInJobRaw`.
- Document extension load steps (Chrome → Load unpacked) in README / easy guide.
- LinkedIn UI changes frequently; isolate selectors behind a versioned adapter module so parser updates do not rewrite upload/API code.

## Success criteria

- User can capture a multi-page LinkedIn Jobs search into Outreach Studio without pasting HTML manually.
- Raw jobs appear in Studio LinkedIn Search with stable progress for large captures.
- Find contacts produces reviewable email leads; Save group creates a usable Recipient Group for outreach.
- No LinkedIn credentials or cookies are stored on the server.
- Org A cannot read org B’s runs, jobs, or candidates.

## Relationship to existing Lead Finder

The 2026-11-06 recruiter Lead Finder design explicitly excluded LinkedIn login/scrape. This module **does not** change that public-web Lead Finder path. It adds a parallel capture source (browser extension) and a dedicated LinkedIn Search workspace. Enrichment may reuse public-web fetch/extract code; it must not add server-side LinkedIn authentication.
