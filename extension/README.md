# Outreach Studio — LinkedIn Jobs Capture (Chrome MV3)

Capture LinkedIn Jobs search results into Outreach Studio. Emails are extracted **only if they appear on the job post itself**. The extension does not search the public web or invent addresses.

## Load unpacked

1. Open Chrome → `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. Click the toolbar icon to open the **side panel**.

## Sign in

1. Set **API base** to the backend origin:
   - local: `http://localhost:8000` (pre-granted)
   - production: e.g. `https://api.example.com` — Chrome will prompt to grant access to **that origin only** when you click Login.
2. Set **Studio URL** to the frontend (local Vite: `http://localhost:5173`; default in the panel is `http://localhost:8080`).
3. Sign in with your Outreach Studio email and password.

## Capture flow

1. Open a **LinkedIn Jobs** search (Jobs only — not People/profiles).
2. **Capture visible** — uploads currently rendered job cards.
3. **Deep capture** — walks more results under a job cap and delay (keep the tab open). **Stop** ends it.
4. **Fetch details** — scrapes the job-detail pane for selected IDs, or all pending jobs if the ID field is blank. Details are usually required before emails appear.
5. Review in Studio **LinkedIn Search** (`/lead-finder/linkedin`). Use **Open Studio** in the side panel, or open that page in Outreach Studio.
6. Review candidates and **Save group** as a Recipient Group.

Use **New run** to start a fresh capture.

## Limits

- Emails are extracted only from text on the captured LinkedIn job post (description, apply/contact blocks). If the post has no email, none is created.
- LinkedIn DOM changes can break capture. Selectors are isolated in `src/lib/selectors.js` — update that file when markup shifts.
- Server caps: `LINKEDIN_CAPTURE_MAX_JOBS_PER_RUN` (default 300) and `LINKEDIN_CAPTURE_HARD_CEILING` (500).

The server never stores LinkedIn cookies or logs into LinkedIn.

## Permissions

`host_permissions` is limited to `https://www.linkedin.com/jobs/*` plus `localhost:8000` / `127.0.0.1:8000`. There is no blanket `https://*/*` grant: arbitrary API origins are declared as `optional_host_permissions` and requested at runtime for the single configured origin.

Tokens (`access_token`, `refresh_token`) are stored in `chrome.storage.local`; the client refreshes via `POST /api/v1/auth/refresh` (`{ "refresh_token": ... }`) on a 401.

## Tests

```
cd extension && npm install && npm test
```

`scripts/test_parsers.mjs` parses fixtures with linkedom (no Chrome needed). Selectors live in `src/lib/selectors.js`.
