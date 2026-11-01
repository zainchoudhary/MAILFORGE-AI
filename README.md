# Outreach Studio

A full-stack email operations application built with **Python 3.12 / FastAPI** and **React / JavaScript / Vite**. Documents become reviewable recipient records; campaigns become personalized, auditable messages. PostgreSQL is the system of record. Redis and Celery perform background extraction and delivery. LangGraph coordinates document, composition, planning, delivery-inspection, and analytics agents.

The application starts in **dry-run mode**. It never treats a dry run as a send or SMTP acceptance as confirmed inbox delivery.

## Start locally

Requirements: Python 3.12+, Node 22 LTS, and a Neon PostgreSQL database. Docker is not required.

```bash
python3 scripts/setup_env.py
cd backend && .venv/bin/alembic upgrade head
cd backend && .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
cd frontend && npm run dev
```

Open **http://localhost:5173**, choose **Create a workspace**, and register an administrator. API docs: **http://localhost:8000/docs**. Health: **http://localhost:8000/health**.

`setup_env.py` creates a private `.env` containing random database, JWT, and encryption secrets. It never overwrites an existing file. Keep this file out of version control. No default administrator password is supplied.

The application includes:

| Service | Responsibility |
|---|---|
| frontend | React/Vite development server |
| backend | FastAPI REST API, authentication, authenticated SSE |
| Neon PostgreSQL | Campaigns, recipients, messages, audit history, agent executions |
| Redis (optional) | Celery broker/results and distributed rate limiting |
| worker | Document extraction and SMTP delivery |
| scheduler | Durable scheduled-campaign dispatch and interrupted-worker recovery |
| migrate | One-shot Alembic migration before app services start |
| clamav | Optional malware scanner, enabled with the `scan` profile |

PostgreSQL, Redis, and backend ports are not exposed by the Compose deployment. Only the frontend port is published.

## Configure intelligence

Edit `.env` on the server:

```dotenv
AI_PROVIDER=groq
GROQ_API_KEY=your_server_side_key
GROQ_MODEL=openai/gpt-oss-20b
```

Or set `AI_PROVIDER=gemini`, `GOOGLE_API_KEY`, and `GEMINI_MODEL` to a model available to your account. Model identifiers are configurable because availability changes. Restart backend, worker, and scheduler after changing configuration.

Without an API key, AI generation returns an explicit configuration error and records the failed agent execution. It does not fabricate generated copy. Document extraction, drafting, templates, recipient review, analytics, and safe dry runs work independently of an LLM key. Requested email content and selected campaign context are sent to the configured AI provider; raw uploaded documents are parsed locally for deterministic extraction.

## Your first workflow

1. **Document intelligence:** upload PDF, DOCX, DOC, XLSX, XLS, CSV, XML, TXT, JSON, PNG, JPG, or JPEG. Click **Extract**. Celery parses the document; scanned PDFs and images use Tesseract. DOC files use antiword.
2. **Review candidates:** edit, remove, or deselect extracted addresses before saving them. Repeat for multiple documents; recipient uniqueness is enforced across the organization. Merely finding an address never grants consent or selects it for a campaign.
3. **Recipients:** record a real consent source for each intended recipient. Populate name, company, position, and custom personalization fields as needed.
4. **SMTP settings:** add an account and test its TLS connection. Credentials are encrypted with Fernet and never returned to the browser. Use a Gmail App Password when applicable.
5. **Compose email:** select recipients or enter addresses, write rich text, reuse a template, attach private files, and optionally schedule. AI writing tools require a configured provider key. CC/BCC are limited to single-primary-recipient campaigns and also require consent.
6. **Save draft:** inspect every personalized message. Per-recipient template assignments can be made on the campaign page. Template attachments are merged into each message's attachment snapshot.
7. **Confirm recipient review** and **Run safe test**. Edits to the campaign, recipient personalization, or assigned template invalidate prior preflight revisions.
8. In dry-run mode, **Approve campaign** is intentionally blocked. To enable live SMTP, an operator must set `DRY_RUN=false`, restart all backend services, and the user must explicitly approve the current reviewed revision.
9. Follow **Email activity** for individual attempts, SMTP responses, failures, attachments, and event history. **Analytics** uses actual database queries; empty workspaces show empty charts.

**Send test to my account** is explicitly restricted to the signed-in user's address. In dry-run mode it produces a preview with zero sends. With live mode enabled and a tested SMTP account it queues a separate test campaign.

## Implemented workspace

- Overview dashboard, charts, real metrics, and empty/error/loading states.
- AI Agent Studio with bounded planning, composition, document-extraction requests, actual failure context, prepared drafts, and execution logs. The LLM cannot approve campaigns or execute arbitrary tools.
- Rich email composer, CC/BCC, personalization, drafts, previews, attachments, templates, and schedules.
- Private document library, extraction review table, cross-document recipient deduplication, PDF/image/text previews, authenticated downloads.
- Campaign editing before delivery, duplication, recipient-template assignment, review/dry-run/approval, pause/resume/cancel, eligible failure retries, CSV reports.
- Searchable, sortable, paginated email activity and detailed message inspection.
- Recipient editing, custom fields, soft deletion, consent history, and suppression management.
- Template creation/editing and reusable template attachment association/removal.
- Daily/weekly/monthly activity windows, campaign comparison, failure inspection, AI insights.
- Automation queue, SMTP setup/test, integration status, audit logs, persisted timezone/compact-table settings.
- JWT access tokens, one-use rotating refresh tokens, Argon2 passwords, administrator/editor/viewer API guards, tenant-scoped queries.
- Signed provider event ingestion, unsubscribe confirmation/one-click POST, automatic bounce suppression.

## Delivery semantics

`queued → sending → smtp_accepted` means the sending server accepted the primary recipient. It does **not** prove inbox delivery. `delivered`, `bounced`, `opened`, and `clicked` require a signed event from a verified provider adapter. Plain Gmail SMTP alone cannot supply those confirmations.

`uncertain` is deliberate: an SMTP disconnect or worker crash may occur after the server accepted message DATA. Outreach Studio does not automatically resend such messages. Review the provider's records before preparing a separate retry campaign. Exactly-once delivery across an SMTP/network boundary cannot be guaranteed; unique message keys and row locks prevent ordinary duplicate queue delivery.

Pause/cancel stops queued work. An SMTP transaction already in progress may complete. Retries use exponential backoff only for explicit temporary SMTP rejections. Suppression and consent are checked again immediately before delivery.

Default safeguards: `DRY_RUN=true`, 20 primary recipients per campaign, 2 seconds between sends per organization, 2 automatic retries, 18,000,000 bytes of raw attachments. MIME/base64 overhead adds to the SMTP message size; provider limits may be lower. Limits are server-controlled.

## Repository

```text
backend/
  app/
    api/v1/               REST endpoints and authenticated events
    agents/               Typed LangGraph orchestration
    analytics/            PostgreSQL aggregate queries
    core/                 Validated environment settings
    database/             SQLAlchemy session and optional seed
    document_processing/  Parsers, OCR, recipient extraction
    email_engine/         Safe personalization
    integrations/         TLS SMTP transport
    models/               Normalized entities and relationships
    repositories/         Tenant ownership, pagination, audit helpers
    schemas/              Pydantic request validation and HTML sanitization
    security/             Passwords, JWT, refresh rotation, encryption
    services/             Campaign invariants and secure file storage
    workers/              Celery queue, retries, dispatcher, recovery
  migrations/             Explicit Alembic schema revision
  tests/                  API, parser, auth, SMTP, queue-state regression tests
frontend/
  src/
    components/           Rich editor, secure previews, tables, shared states
    components/ui/        JavaScript shadcn-style Radix button/dialog primitives
    context/              Authentication state
    hooks/                React Query hooks and mutation feedback
    layouts/              Responsive workspace shell
    pages/                Connected product views
    services/             Axios, refresh rotation, private downloads
    styles/               Navy/cyan design system and responsive layouts
scripts/                  Environment generation and HTTP smoke verification
docs/                     Architecture, deployment, API and verification guides
```

## Local development

Use Python **3.12+**, Node **22 LTS** for frontend development, PostgreSQL, Redis, libmagic, Tesseract and antiword. Node is never a backend runtime.

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
npm ci --prefix frontend
```

Keep secrets in the root `.env` (ignored by git). `DATABASE_URL` points to Neon using the `postgresql+psycopg://` scheme. `REDIS_URL` is optional for the API and required only for Celery worker/scheduler processes. Uploaded files are stored under `.local/uploads`.

In separate terminals:

```bash
cd backend
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd backend
.venv/bin/celery -A app.workers.celery_app:celery worker --loglevel=info
# On macOS development, add --pool=solo.
```

```bash
cd backend
.venv/bin/celery -A app.workers.celery_app:celery beat --loglevel=info --schedule=/tmp/mailforge-beat
```

```bash
cd frontend
npm run dev
```

Open http://localhost:5173. Vite proxies REST, SSE, and API documentation to FastAPI. A macOS development fallback uses the system `file` command when Python libmagic cannot load.

Optional seed: run `python -m app.database.seed` with `SEED_EMAIL` and a 12+ character `SEED_PASSWORD`. It creates a development account and one template, never artificial delivery metrics.

## Tests

Use an isolated PostgreSQL database ending in `_test`. Tests refuse to drop tables in a database without that suffix. The default local test ports are PostgreSQL 55432 and Redis 56379 (Redis database 15). Override `DATABASE_URL` and `REDIS_URL` as needed. **The selected test database and Redis database are reset by tests.**

```bash
cd backend
.venv/bin/python -m pytest -q
.venv/bin/alembic check
```

```bash
npm test --prefix frontend
npm run build --prefix frontend
```

With the local API and Celery worker running:

```bash
backend/.venv/bin/python scripts/smoke_test.py
```

The smoke test registers an isolated synthetic workspace, performs real queued extraction, reviews a campaign, confirms zero sends, and asserts that dry-run blocks production approval. It stores its generated test credentials privately under ignored `.local/` without printing them.

See [verification results](docs/VERIFICATION.md) for exactly what was exercised and environmental limitations. See [deployment](docs/DEPLOYMENT.md), [architecture](docs/ARCHITECTURE.md), and [API guide](docs/API.md) for operation and extension details.
