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
- Jobs: scrolls the list and opens a few cards per batch for description text.
- Caps: max 500 emails / items per run. Selectors: `src/lib/posts.js`, `src/lib/selectors.js`.
