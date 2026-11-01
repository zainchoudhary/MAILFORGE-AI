# Verification record

Local verification date: **30 October 2026**.

## Executed successfully

- React production build with Vite, React/JavaScript, route-level lazy loading, and generated static assets.
- Four frontend component tests: truthful SMTP status labeling, sandboxed email HTML, pagination boundaries, and API-error retry behavior.
- PostgreSQL-backed Pytest suite covering authentication, refresh rotation, cross-tenant isolation, consent/approval gates, dry-run zero-send behavior, revision invalidation, message idempotency, actual aggregate metrics, signed provider events, queued uploads and LangGraph extraction, missing-AI-key errors, transient retries, schedules, late suppression, stale sending leases, attachment preview/access, and template attachment lifecycle.
- Real local SMTP test server accepting an email and verifying Message-ID, unsubscribe headers, and absence of BCC headers. The network transport is exercised locally; production TLS/provider credentials are not used.
- Text, JSON, XML, CSV, DOCX, XLSX, and PDF parsing. Malicious XML entities and MIME/extension mismatch rejection.
- Explicit Alembic initial migration applied to the local development PostgreSQL database. `alembic check` reported no schema drift.
- Real running FastAPI + PostgreSQL + Redis + Celery HTTP smoke test: CSV upload → worker extraction → duplicate elimination → reviewed recipient → campaign → dry run → live approval blocked. No email was sent.
- Neon-backed Alembic migration and local frontend/backend build configuration verified without Docker.

## Environment-limited verification

- **Native OCR test skipped locally:** Tesseract is not installed, and Homebrew installation was blocked by host directory ownership/permissions. The backend Dockerfile and Linux CI install Tesseract, antiword, libmagic, and test fonts. The OCR integration is implemented, but successful native OCR execution was not demonstrated on this host.
- **Legacy DOC/XLS:** parser implementations and dependencies are included; no representative binary legacy files were supplied for a local fixture-based verification. Modern DOCX/XLSX paths were exercised.
- **Container build/run not executed:** Docker CLI exists but the daemon is unavailable, and the Compose v2 plugin was not available in this shell. Local services were used instead. Structural YAML validation is not a substitute for an image build and full Compose run.
- **Browser visual/E2E interaction not executed:** the Browser runtime reported no connected browsers. Build tests, frontend component tests, and real HTTP smoke tests ran; screenshot/responsive browser inspection did not.
- **Live Groq/Gemini inference not executed:** no provider credentials were supplied. Missing-key errors and execution recording were verified; actual model response quality and selected model availability require configured credentials.
- **Live external SMTP/TLS not executed:** no real provider credentials were supplied. Safe SMTP transport and deterministic delivery-worker state transitions were tested; Gmail/app-password and external TLS success require deployment credentials.
- **ClamAV and external provider adapters:** integration contracts exist; no scanner or provider webhook service was available for an external end-to-end test. Signed-event validation was exercised locally.

The committed CI workflow is ready to run on Linux with PostgreSQL, Redis, OCR, and parsing dependencies. Its existence is not a claim that remote CI has run. A final live-provider, container, and browser acceptance pass is required before treating a deployment as production-certified.
