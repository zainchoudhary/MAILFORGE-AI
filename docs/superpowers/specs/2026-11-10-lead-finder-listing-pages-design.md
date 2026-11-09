# Lead Finder listing pages (Google + LinkedIn)

**Date:** 2026-11-10  
**Status:** Approved (Option B) — implement

## Goal

Match **Campaigns** IA for Outreach Intelligence:

- Clean **listing** pages for Google Search and LinkedIn Search
- **Detail** pages for a single run (no “Recent history” sidebar)
- LinkedIn listing: short **Start in extension** banner
- Google listing: short **New search** banner/CTA (search starts in Studio)

## Routes

| Path | Page |
| --- | --- |
| `/lead-finder/gmail` | Google Search listing |
| `/lead-finder/gmail/:runId` | Google run detail (candidates) |
| `/lead-finder/linkedin` | LinkedIn Search listing |
| `/lead-finder/linkedin/:runId` | LinkedIn capture detail (leads) |

Redirects: `?run=` deep links → `/:runId`. Extension Open-in-Studio URL updated to path style when touched; keep `?run=` fallback.

## Listing UI (both)

- `PageHeader` (eyebrow, title, description) + Refresh
- Top banner/callout (LinkedIn: extension collect; Google: start new search)
- `panel` table like Campaigns: title/query, status, counts, date, open + delete
- Empty state when no runs
- Bulk delete optional if already supported by API (LinkedIn has bulk-delete; Google if available)

## Detail UI

- Back link to listing
- Full-width run workspace (jobs/progress + leads)
- **Remove** right-hand Recent captures / Recent searches aside

## Out of scope

- Extension UI changes (except Studio deep-link path if trivial)
- New backend tables
