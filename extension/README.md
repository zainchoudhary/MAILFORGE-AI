# Outreach Studio — LinkedIn Capture (Chrome MV3)

**Goal:** Like Lead Finder / Gmail search — set how many **emails** you need; the extension scrolls LinkedIn (posts feed or Jobs) until that many leads are extracted into Outreach Studio.

## Load unpacked

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → this `extension/` folder.
2. After code changes: **Reload** the extension.

## Use

1. Sign in (API base `http://localhost:8000`, Studio `http://localhost:5173`).
2. Open LinkedIn **Home feed** (best for posts with emails) or a **Jobs** search.
3. Set **Emails needed** (e.g. 20).
4. Click **Start** — it auto-scrolls, uploads raw text, extracts emails.
5. **Stop** anytime. **Open in Studio** → review → Save as recipient group.

Emails are taken only from captured LinkedIn text (never invented).

## Notes

- Posts: full text is captured immediately.
- Post links: for posts containing emails, capture tries the same card's three-dot **Copy link to post** action. It preserves LinkedIn short links (`lnkd.in/p/...`) and never constructs a URL from a `share` or `ugcPost` ID alone. If the menu is unavailable, it keeps a usable DOM link or activity permalink; otherwise the link stays unavailable.
- The copy fallback supports the English **Copy link to post** menu. It captures the copy action without reading existing clipboard contents. After upgrading to 0.5.1, reload the extension, refresh LinkedIn, and collect again to replace old incorrect links.
- Jobs: scrolls the list and opens a few cards per batch for description text.
- Caps: max 500 emails / items per run. Selectors: `src/lib/posts.js`, `src/lib/selectors.js`.
