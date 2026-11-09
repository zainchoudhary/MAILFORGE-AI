# LinkedIn post permalink bind (email → post URL)

**Date:** 2026-11-10  
**Status:** Approved (Approach 1 — capture-time hard bind)  
**Goal:** Every lead email extracted from a LinkedIn post ships with that post’s real openable permalink as `source_url` / Go to post.

## Problem

- Many leads show **—** instead of Go to post.
- Some Go to post links open LinkedIn **Post not found** or the wrong post.
- Root cause: email is often attached to a **too-small DOM container** (commentary text) that has author/time in text but **no `data-urn` and no `/posts/` or `/feed/update/` anchor**. Permalink exists on the real post card / ancestor; we were not climbing to it. Reconstructed weak URNs also 404 when inventing the wrong kind/id.

## LinkedIn URL rules (source of truth)

Every content/feed post LinkedIn shows has at least one of:

1. **`/posts/{slug}-activity-{id}-{suffix}/`** — preferred; most reliable to open.
2. **`/feed/update/urn:li:activity:{id}/`** (or `ugcPost` / `share`) — valid when the URN is the card’s real `data-urn` / timestamp href.
3. **`data-urn` / `data-chameleon-result-urn` / `data-id`** containing `urn:li:(activity|ugcPost|share):{digits}`.

Never treat as post permalink:

- `/search/results/...`
- `/jobs/search`, `/jobs/collections`
- Profile `/in/...` (not the post)
- Hashed synthetic ids (`p` + base36) — must not invent a feed URN from these

## Design (Approach 1)

### Extension

1. **`hasPostPermalinkSignal(el)`** — true if node (or descendants) has urn attrs or post/feed anchors.
2. **`closestPostContainer`** — prefer containers with permalink signal; do not stop on a text-only fallback when an ancestor has the signal.
3. **`resolvePostPermalink(card)`** — resolve URL from card, then walk ancestors (bounded) collecting `/posts/` first, then `/feed/update/`, then URN rebuild with correct kind.
4. **`cardToPost`** — always set `job_url` + `detail_payload.post_url` via `resolvePostPermalink`; keep `list_payload.urn`.
5. **Email attach path** (`jobs.js`) — when binding email → card, if URL still empty after resolve, climb again; never prefer synthetic email-only rows when a card exists.
6. **Post-pass** — before upload, for any item with empty `job_url` but `list_payload.urn`, fill from `urlFromActivityUrn`.

### Backend

1. **`canonicalize_post_url`** — prefer `/posts/` over feed URN; preserve `ugcPost`/`share` kind; never build URN from non-digit `p…` hashes.
2. **Extract / upsert** — always copy canonical URL into candidate `source_url` + `signals.post_url`; upgrade weak feed URLs to `/posts/` when a later batch has one.
3. **`list_candidates` enrich** — fill empty `source_url` from linked job’s canonical permalink (display + Go to post).

### Studio

- Go to post uses `source_url` or `signals.post_url` only when it matches `/posts/` or `/feed/update/`.
- View post keeps existing body/meta; button opens that URL.

## Success criteria

- New Collect: every lead whose email came from a visible post card has a Go to post link.
- Clicking it opens that same post in LinkedIn (not search, not Post not found for live posts).
- Fixture/unit tests cover: `/posts/` preferred over feed URN; TreeWalker card climbs to urn-bearing ancestor; empty URL filled from urn.

## Out of scope

- Repairing historically wrong URNs already saved (user re-Collects).
- Clicking LinkedIn “Copy link to post” menu automation.
- Profile `/in/` fallback as Go to post.
