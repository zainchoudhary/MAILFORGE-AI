# Rich LinkedIn post capture (email posts)

**Date:** 2026-11-09  
**Status:** Approved for implementation (pending user review of this file)  
**Scope:** Extension + LinkedIn capture extract/API + Studio LinkedIn Finder UI

## Goal

When Collect finds a public email in a LinkedIn post, save **full post context**, not only the email:

| Field | Source on LinkedIn card | Stored as |
| --- | --- | --- |
| Post permalink | URN / post link | `job_url` → candidate `source_url` |
| Poster name | Actor name | candidate `name` |
| Poster designation / headline | Actor description / subtitle | candidate `position` |
| Company (if present in subtitle) | Actor meta | candidate `company` (best-effort) |
| Post date/time | Relative or absolute time on card | `signals.posted_at` (+ raw `signals.posted_at_text`) |
| Full post body | Expanded commentary / description | job `detail_payload.description` + `signals.post_body` |

**Out of scope:** Saving posts with no email (Option A). New DB tables. Changing Collect stop rules (still email-target driven).

## Product behavior

1. Collect still scrolls until **Emails needed** is reached (or Stop / exhausted / safety cap).
2. Only posts that yield at least one extractable public email are useful as leads; each such lead carries rich post metadata.
3. Studio LinkedIn Finder table shows: email, name, designation (`position`), post date, post link.
4. Full post text opens via a **View post** expand/drawer on the row (not a permanent full-text column).

## Approach

**Enrich existing capture pipeline** (no new `posts` table).

- Extension already uploads post-shaped “jobs” with `list_payload.kind = "post"` and `detail_payload.description`.
- Strengthen DOM extraction (date + fuller body + clearer headline).
- Backend extract already maps `author` → `name` and `subtitle` → `position` for posts; extend with `posted_at` / `post_body` in `signals`.
- Studio reads those fields from the candidates API (already serializes `signals`).

## Architecture

```text
LinkedIn content search (DOM)
  → posts.js parseVisiblePosts (rich fields)
  → HUNT_BATCH upload (linkedin_job_raw)
  → extract_from_job (email + map author/subtitle/date/body → candidate)
  → Studio LinkedInFinder table + View post
```

### Extension (`extension/src/lib/posts.js` + content helpers)

- After “see more”, capture **full** commentary text (raise truncation ceiling if needed; keep a hard max e.g. 20k chars).
- Parse **posted time** from time elements (`time`, `a[href*="recent-activity"]` siblings, actor sub-description patterns). Store:
  - `posted_at_text` — visible string (e.g. `2d`, `3h`, `Nov 8, 2026`)
  - `posted_at` — ISO-8601 when `datetime` attribute exists; else omit
- Treat actor **headline/designation** as first-class: prefer description/subtitle selectors; avoid conflating with “Celebrated by…” noise when possible.
- `list_payload` / `detail_payload` include: `kind`, `author`, `subtitle` (designation), `posted_at`, `posted_at_text`, `description` (full body), `post_url`, `urn`, `source`.

### Backend (`linkedin_capture/extract.py`)

- For `kind in ("post", "search_email")`:
  - `name` ← author (fallback existing near-email name)
  - `position` ← subtitle / designation
  - `source_url` ← canonical post permalink (existing)
  - `source_title` ← author or short post title
  - `signals.posted_at` / `signals.posted_at_text`
  - `signals.post_body` ← full description (for View post without extra job fetch)
- Keep near-email `snippet` for scoring/context; do **not** replace it with the entire post unless empty.
- No migration required for v1 (reuse `signals` JSON + existing columns).

### Studio (`LinkedInFinder.jsx`)

- Table columns: Email | Name | Designation | Posted | Link | (existing select / actions).
- **View post** control expands row or opens a small panel with `signals.post_body` (fallback: `snippet`).
- Posted column shows `posted_at_text` or formatted `posted_at`; empty → `—`.

## Error handling / resilience

- Missing date or designation: still save email + whatever fields exist; UI shows `—`.
- Truncated LinkedIn DOM: expand “see more” first; if still short, store what is visible.
- Search URLs must never become `source_url` (existing canonicalize rules stay).

## Testing

- Extension parser fixtures: card with author, headline, time, full body + email → payload fields asserted.
- Backend extract: post payload maps designation → `position`, date → `signals`, body → `signals.post_body`.
- Frontend: smoke that View post renders body when `signals.post_body` present (lightweight if no component test harness).

## Non-goals

- Capturing likes/comments/media URLs as first-class fields (may appear inside `post_body` text only).
- Opening every post in a new tab to scrape detail pages.
- Changing auth, theme, or Collect target logic.

## Success criteria

- New Collect runs produce leads where email posts show name, designation, date (when LinkedIn exposes them), permalink, and full body under View post.
- Collect still stops primarily on email target, not on “posts scanned.”
