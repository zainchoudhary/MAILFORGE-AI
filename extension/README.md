# Outreach Studio — LinkedIn Jobs Capture (Chrome MV3)

Minimal load steps (expanded in Task 8).

## Load

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this `extension/` folder.
2. Click the toolbar icon to open the side panel.
3. Set **API base** to your API origin:
   - local: `http://localhost:8000` (pre-granted)
   - production: e.g. `https://api.example.com` — Chrome will prompt to grant access to **that origin only** when you click Login.
4. Set **Studio URL** (frontend; default `http://localhost:8080`) used for the "Open Studio" link, then log in with your Outreach Studio email/password.
5. Open a LinkedIn Jobs search page, click **Capture visible**. Use **New run** to start a fresh run.

## Permissions

`host_permissions` is limited to `https://www.linkedin.com/jobs/*` plus `localhost:8000` / `127.0.0.1:8000`. There is no blanket `https://*/*` grant: arbitrary API origins are declared as `optional_host_permissions` and requested at runtime for the single configured origin.

Tokens (`access_token`, `refresh_token`) are stored in `chrome.storage.local`; the client refreshes via `POST /api/v1/auth/refresh` (`{ "refresh_token": ... }`) on a 401.

## Tests

```
cd extension && npm install && npm test
```

`scripts/test_parsers.mjs` parses `fixtures/jobs-list.html` with linkedom (no Chrome needed). Selectors live in `src/lib/selectors.js`.

Deep capture / job-detail fetch is not implemented yet (Task 6).
