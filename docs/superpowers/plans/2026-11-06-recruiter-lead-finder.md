# Recruiter Lead Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dedicated Lead Finder page that turns natural-language recruiter searches into reviewable email candidates and saves selected ones as a recipient group.

**Architecture:** Deterministic pipeline under `backend/app/lead_finder/` (brief parse → web search → page fetch → extract/filter → persist candidates). HTTP creates a `LeadSearchRun` and enqueues Celery; UI polls. Save reuses/creates `Recipient` rows and a `RecipientGroup`. AI Agent Studio stays unchanged.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Celery, httpx, existing Groq/Gemini LLM helpers, React, React Query, Vite.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-06-recruiter-lead-finder-design.md`
- Audience v1: recruiters / talent acquisition only
- Never invent emails; extract only from search snippets + fetched page text
- No LinkedIn auth/scrape; no Hunter/Apollo; no auto-campaign send; no consent gate
- Valid candidate: email + (name or company); hard-reject noreply-style mailboxes
- `LEAD_FINDER_MAX_PER_RUN` default 100; first-batch preview budget ≈ 20
- Do not overload `backend/app/agents/orchestrator.py` with web fetch
- Do not commit unless the user explicitly asks

## File map

| Path | Responsibility |
|---|---|
| `backend/app/lead_finder/__init__.py` | Package marker |
| `backend/app/lead_finder/schemas.py` | Pydantic brief + candidate draft types |
| `backend/app/lead_finder/extract.py` | Email/name/company/title extract + quality heuristics |
| `backend/app/lead_finder/search.py` | `SearchHit` + Serper / Google CSE clients |
| `backend/app/lead_finder/fetch.py` | Public page fetch (timeout, size limit) |
| `backend/app/lead_finder/brief.py` | NL instruction → structured brief via LLM |
| `backend/app/lead_finder/pipeline.py` | One batch: query → search → fetch → extract → upsert candidates |
| `backend/app/lead_finder/service.py` | Create/continue/cancel/save-group orchestration |
| `backend/app/api/v1/lead_finder.py` | REST routes under `/lead-finder` |
| `backend/app/models/entities.py` | `LeadSearchRun`, `LeadCandidate` |
| `backend/migrations/versions/0005_lead_finder.py` | Tables + indexes |
| `backend/app/core/config.py` | Lead finder settings |
| `backend/app/workers/tasks.py` | `run_lead_finder_batch` Celery task |
| `backend/app/main.py` | Mount lead_finder router |
| `backend/tests/test_lead_finder_extract.py` | Unit tests for extract/quality |
| `backend/tests/test_lead_finder_api.py` | API + save-group with mocked search/fetch |
| `frontend/src/pages/LeadFinder.jsx` | Chat, progress, review table, save |
| `frontend/src/services/leadFinder.js` | API helpers (optional thin wrappers) |
| `frontend/src/App.jsx` | Route `lead-finder` |
| `frontend/src/layouts/Workspace.jsx` | Sidebar nav item |
| `frontend/src/styles/index.css` (or page CSS) | Lead Finder layout hooks |
| `.env.example` + README | Document provider env keys |

---

### Task 1: Settings + extract quality (pure functions)

**Files:**
- Create: `backend/app/lead_finder/__init__.py`
- Create: `backend/app/lead_finder/schemas.py`
- Create: `backend/app/lead_finder/extract.py`
- Modify: `backend/app/core/config.py`
- Modify: `.env.example`
- Test: `backend/tests/test_lead_finder_extract.py`

**Interfaces:**
- Produces:
  - `Settings` fields: `lead_search_provider: str = "serper"`, `serper_api_key: str = ""`, `google_cse_api_key: str = ""`, `google_cse_cx: str = ""`, `lead_finder_max_per_run: int = 100`, `lead_finder_first_batch: int = 20`, `lead_finder_fetch_timeout: int = 15`, `lead_finder_max_page_bytes: int = 1_500_000`
  - `CandidateDraft(email, name, company, position, source_url, source_title, snippet, score, signals: dict, selected: bool)`
  - `extract_candidates_from_text(text: str, *, source_url: str, source_title: str = "", snippet: str = "") -> list[CandidateDraft]`
  - `is_hard_rejected_email(email: str) -> bool`
  - `normalize_email(email: str) -> str`

- [ ] **Step 1: Write failing extract tests**

```python
# backend/tests/test_lead_finder_extract.py
from app.lead_finder.extract import extract_candidates_from_text, is_hard_rejected_email, normalize_email

def test_normalize_and_hard_reject():
    assert normalize_email(" Alex@Acme.COM ") == "alex@acme.com"
    assert is_hard_rejected_email("noreply@acme.com")
    assert is_hard_rejected_email("no-reply@acme.com")
    assert not is_hard_rejected_email("jane.doe@acme.com")

def test_extract_requires_email_and_name_or_company():
    text = "Jane Doe is a Technical Recruiter at Acme. Contact jane.doe@acme.com for roles."
    drafts = extract_candidates_from_text(text, source_url="https://acme.com/team")
    assert len(drafts) == 1
    assert drafts[0].email == "jane.doe@acme.com"
    assert "Jane" in drafts[0].name or drafts[0].company
    assert drafts[0].selected is True  # recruiter title heuristic

def test_info_at_without_person_name_is_deselected():
    text = "Careers: info@startup.io hiring recruiters"
    drafts = extract_candidates_from_text(text, source_url="https://startup.io/jobs")
    assert drafts
    assert all(d.selected is False for d in drafts if d.email.startswith("info@"))

def test_noreply_never_returned():
    text = "Send bounce to noreply@acme.com — Jane Recruiter jane@acme.com"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert all(d.email != "noreply@acme.com" for d in drafts)
    assert any(d.email == "jane@acme.com" for d in drafts)
```

- [ ] **Step 2: Run tests — expect fail (module missing)**

Run: `cd backend && .venv/bin/pytest tests/test_lead_finder_extract.py -v`  
Expected: FAIL import error

- [ ] **Step 3: Add settings fields**

In `backend/app/core/config.py` on `Settings`, add:

```python
lead_search_provider: str = "serper"  # serper | google_cse
serper_api_key: str = ""
google_cse_api_key: str = ""
google_cse_cx: str = ""
lead_finder_max_per_run: int = 100
lead_finder_first_batch: int = 20
lead_finder_fetch_timeout: int = 15
lead_finder_max_page_bytes: int = 1500000
```

Append to `.env.example`:

```dotenv
LEAD_SEARCH_PROVIDER=serper
SERPER_API_KEY=
GOOGLE_CSE_API_KEY=
GOOGLE_CSE_CX=
LEAD_FINDER_MAX_PER_RUN=100
LEAD_FINDER_FIRST_BATCH=20
```

- [ ] **Step 4: Implement schemas + extract**

`schemas.py`:

```python
from pydantic import BaseModel, Field, field_validator

class LeadBrief(BaseModel):
    roles: list[str] = Field(default_factory=lambda: ["recruiter", "talent acquisition"])
    location: str = ""
    keywords: list[str] = Field(default_factory=list)
    industry: str = ""
    target_count: int = Field(default=20, ge=1, le=100)
    exclusions: list[str] = Field(default_factory=list)

class CandidateDraft(BaseModel):
    email: str
    name: str = ""
    company: str = ""
    position: str = ""
    source_url: str
    source_title: str = ""
    snippet: str = ""
    score: float = 0
    signals: dict = Field(default_factory=dict)
    selected: bool = False

    @field_validator("email")
    @classmethod
    def lower(cls, value: str) -> str:
        return value.strip().lower()
```

`extract.py` — implement regex email find, skip hard-rejected local-parts (`noreply`, `no-reply`, `donotreply`, `do-not-reply`, `mailer-daemon`), require name or company from nearby window/heuristics, title keywords for default `selected=True`: `recruiter`, `talent acquisition`, `talent partner`, `hiring manager`, `people ops`, `people operations`, whole-word `ta`. Soft-deselect `info@`/`careers@`/`jobs@`/`hr@` when no person-like name. Never invent emails.

- [ ] **Step 5: Run tests — expect pass**

Run: `cd backend && .venv/bin/pytest tests/test_lead_finder_extract.py -v`  
Expected: PASS

---

### Task 2: Models + migration

**Files:**
- Modify: `backend/app/models/entities.py`
- Create: `backend/migrations/versions/0005_lead_finder.py`
- Test: covered by API tests in Task 5 (metadata create_all in conftest picks up models)

**Interfaces:**
- Produces ORM: `LeadSearchRun`, `LeadCandidate` as specified below

- [ ] **Step 1: Add entity classes** to `backend/app/models/entities.py` (after recipient group models):

```python
class LeadSearchRun(Tenant, Base):
    __tablename__ = "lead_search_runs"
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    instruction: Mapped[str] = mapped_column(Text)
    brief: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    target_count: Mapped[int] = mapped_column(Integer, default=20)
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class LeadCandidate(Tenant, Base):
    __tablename__ = "lead_candidates"
    __table_args__ = (UniqueConstraint("run_id", "email"),)
    run_id: Mapped[str] = mapped_column(ForeignKey("lead_search_runs.id"), index=True)
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(200), default="")
    company: Mapped[str] = mapped_column(String(200), default="")
    position: Mapped[str] = mapped_column(String(200), default="")
    source_url: Mapped[str] = mapped_column(Text, default="")
    source_title: Mapped[str] = mapped_column(String(500), default="")
    snippet: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[float] = mapped_column(default=0)
    signals: Mapped[dict] = mapped_column(JSON, default=dict)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    existing_recipient_id: Mapped[str | None] = mapped_column(ForeignKey("recipients.id"))
```

- [ ] **Step 2: Alembic revision `0005`** (`down_revision = "0004"`)

Create tables `lead_search_runs` and `lead_candidates` with indexes matching entities (`organization_id`, `status`, `run_id`, unique `(run_id, email)`). Include `updated_at` on runs.

- [ ] **Step 3: Apply locally**

Run: `cd backend && .venv/bin/alembic upgrade head`  
Expected: upgrade succeeds

---

### Task 3: Search + fetch clients

**Files:**
- Create: `backend/app/lead_finder/search.py`
- Create: `backend/app/lead_finder/fetch.py`
- Test: `backend/tests/test_lead_finder_search.py`

**Interfaces:**
- Produces:
  - `SearchHit(title: str, url: str, snippet: str)`
  - `search_web(query: str, num: int = 10) -> list[SearchHit]` — reads `get_settings()`; raises `LeadSearchConfigError` if key missing
  - `fetch_page_text(url: str) -> str | None` — returns None on failure; strips tags to text; enforces timeout/size

- [ ] **Step 1: Failing test with httpx mock**

```python
# backend/tests/test_lead_finder_search.py
import httpx
import respx  # if not installed, use unittest.mock.patch on httpx.Client
from app.core.config import get_settings
from app.lead_finder.search import search_web, LeadSearchConfigError
from app.lead_finder.fetch import fetch_page_text

def test_search_requires_key(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("SERPER_API_KEY", "")
    get_settings.cache_clear()
    # re-import or clear cache then set settings fields directly:
    s = get_settings()
    s.serper_api_key = ""
    s.lead_search_provider = "serper"
    try:
        search_web("recruiter london")
        assert False, "expected config error"
    except LeadSearchConfigError as err:
        assert "SERPER_API_KEY" in str(err)

def test_fetch_returns_none_on_error(monkeypatch):
    def boom(*a, **k):
        raise httpx.TimeoutException("timeout")
    monkeypatch.setattr("app.lead_finder.fetch.httpx.Client.get", boom)
    # Prefer patching the client used inside fetch_page_text
    assert fetch_page_text("https://example.com") is None
```

If `respx` is not a dependency, use `unittest.mock.patch` only — do not add new packages unless already present. Prefer `unittest.mock`.

- [ ] **Step 2: Implement `search.py`**

```python
class LeadSearchConfigError(RuntimeError):
    pass

@dataclass
class SearchHit:
    title: str
    url: str
    snippet: str

def search_web(query: str, num: int = 10) -> list[SearchHit]:
    s = get_settings()
    provider = (s.lead_search_provider or "serper").lower()
    if provider == "serper":
        if not s.serper_api_key:
            raise LeadSearchConfigError(
                "Configure SERPER_API_KEY to enable Lead Finder search."
            )
        # POST https://google.serper.dev/search with header X-API-KEY
        # map organic results to SearchHit
    elif provider == "google_cse":
        if not s.google_cse_api_key or not s.google_cse_cx:
            raise LeadSearchConfigError(
                "Configure GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX to enable Lead Finder search."
            )
        # GET https://www.googleapis.com/customsearch/v1
    else:
        raise LeadSearchConfigError("LEAD_SEARCH_PROVIDER must be serper or google_cse")
```

Use `httpx.Client` with short timeout. Map only `http`/`https` URLs.

- [ ] **Step 3: Implement `fetch.py`**

Use httpx GET, follow redirects modestly, reject non-2xx, cap bytes via `lead_finder_max_page_bytes`, decode text, strip script/style, regex-strip tags to whitespace text. Catch all network errors → `None`.

- [ ] **Step 4: Run unit tests**

Run: `cd backend && .venv/bin/pytest tests/test_lead_finder_search.py -v`  
Expected: PASS

---

### Task 4: Brief parser + pipeline batch

**Files:**
- Create: `backend/app/lead_finder/brief.py`
- Create: `backend/app/lead_finder/pipeline.py`
- Test: `backend/tests/test_lead_finder_pipeline.py`

**Interfaces:**
- Consumes: `LeadBrief`, `search_web`, `fetch_page_text`, `extract_candidates_from_text`, models
- Produces:
  - `parse_lead_brief(instruction: str, target_count_override: int | None = None) -> LeadBrief`
  - `build_search_queries(brief: LeadBrief) -> list[str]` — always include recruiter/TA terms
  - `run_lead_batch(db, run_id: str, *, batch_limit: int) -> dict` — updates run progress/status, upserts `LeadCandidate`s, returns summary counts

- [ ] **Step 1: Pipeline test with mocked search/fetch**

```python
def test_run_lead_batch_upserts_candidates(db, account, monkeypatch):
    # create org user + LeadSearchRun with brief target_count=5 status=queued
    monkeypatch.setattr(
        "app.lead_finder.pipeline.search_web",
        lambda q, num=10: [SearchHit("Acme Team", "https://acme.test/team", "Jane Recruiter")],
    )
    monkeypatch.setattr(
        "app.lead_finder.pipeline.fetch_page_text",
        lambda url: "Jane Doe, Technical Recruiter, jane.doe@acme.test",
    )
    summary = run_lead_batch(db, run.id, batch_limit=20)
    db.refresh(run)
    assert run.status == "ready"
    assert summary["kept"] >= 1
    rows = db.scalars(select(LeadCandidate).where(LeadCandidate.run_id == run.id)).all()
    assert any(r.email == "jane.doe@acme.test" for r in rows)
```

Wire fixtures by creating rows via SQLAlchemy in the test (resolve `organization_id` from registered user / db query).

- [ ] **Step 2: Implement `brief.py`**

Reuse `invoke_structured` + `llm` from `app.agents.orchestrator` (import those helpers only — do not add new LangGraph nodes). System prompt: extract recruiter-focused brief; clamp `target_count` to `1..lead_finder_max_per_run`; if LLM unavailable, fallback heuristic: `target_count` from first integer in instruction or override, default roles `["recruiter", "talent acquisition"]`, rest empty.

- [ ] **Step 3: Implement `pipeline.py`**

Algorithm:
1. Load run; if `cancelled`, return early.
2. Set `status=running`.
3. `queries = build_search_queries(brief)` e.g. `"{role} email {location} {industry} {keywords}"` and `"{role} contact {company-ish keywords}"` — keep list short (3–6).
4. Track `progress` keys: `queries_done`, `pages_fetched`, `candidates_kept`, `message`, `warning`.
5. For each query until `candidates_kept >= batch_limit` or queries exhausted: `search_web` → for each hit `fetch_page_text` (skip None) → extract from `snippet + "\n" + page_text` → upsert by normalized email on this run.
6. When resolving existing recipients: look up active `Recipient` by org+email; set `existing_recipient_id`. If email on `Suppression` for org, force `selected=False` and signal `suppressed`.
7. On `LeadSearchConfigError`: set `failed` + error message.
8. On success: `ready` (even if 0 candidates); if partial provider errors, set `progress.warning`.
9. Dedupe within run via unique constraint; update existing candidate fields if seen again with higher score.

`build_search_queries` must bias to public contact pages (team, about, careers) in query text — never instruct LinkedIn login.

- [ ] **Step 4: Run pipeline tests**

Run: `cd backend && .venv/bin/pytest tests/test_lead_finder_pipeline.py -v`  
Expected: PASS

---

### Task 5: Service layer + Celery + API

**Files:**
- Create: `backend/app/lead_finder/service.py`
- Create: `backend/app/api/v1/lead_finder.py`
- Modify: `backend/app/workers/tasks.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/schemas/inputs.py` (request bodies)
- Test: `backend/tests/test_lead_finder_api.py`

**Interfaces:**
- Produces service functions:
  - `create_run(db, user, instruction: str, target_count: int | None) -> LeadSearchRun`
  - `enqueue_or_run(run_id: str) -> None`
  - `continue_run(db, user, run_id: str) -> LeadSearchRun`
  - `cancel_run(db, user, run_id: str) -> LeadSearchRun`
  - `save_group(db, user, run_id: str, group_name: str, candidate_ids: list[str] | None) -> dict`
- API paths exactly as spec (`/api/v1/lead-finder/...`)

- [ ] **Step 1: Write API tests (mocked pipeline enqueue)**

```python
def test_create_run_returns_immediately(client, account, monkeypatch):
    monkeypatch.setattr(
        "app.lead_finder.service.parse_lead_brief",
        lambda instruction, target_count_override=None: LeadBrief(
            roles=["recruiter"], location="London", target_count=target_count_override or 25
        ),
    )
    monkeypatch.setattr("app.lead_finder.service.enqueue_or_run", lambda run_id: None)
    res = client.post(
        "/api/v1/lead-finder/runs",
        headers=account,
        json={"instruction": "Find 25 recruiters in London", "target_count": 25},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] in ("queued", "running")
    assert body["target_count"] == 25
    assert "id" in body

def test_save_group_creates_recipients_and_group(client, account, db, monkeypatch):
    # seed a ready run + 2 selected LeadCandidates
    # POST save-group
    res = client.post(
        f"/api/v1/lead-finder/runs/{run_id}/save-group",
        headers=account,
        json={"group_name": "London Recruiters"},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["created"] >= 1
    assert data["group_name"] == "London Recruiters"
    groups = client.get("/api/v1/recipient-groups", headers=account).json()["items"]
    assert any(g["name"] == "London Recruiters" for g in groups)

def test_save_group_empty_selection_422(client, account, db):
    # ready run, all selected=False
    res = client.post(..., json={"group_name": "Empty"})
    assert res.status_code == 422

def test_save_group_duplicate_name_409(client, account, db):
    # pre-create group with same name via existing API (needs >=2 recipients)
    # then save-group with same name → 409
```

- [ ] **Step 2: Input schemas** in `backend/app/schemas/inputs.py`:

```python
class LeadFinderRunInput(Input):
    instruction: str = Field(min_length=3, max_length=4000)
    target_count: int | None = Field(default=None, ge=1, le=100)

class LeadCandidatePatch(Input):
    email: str | None = Field(default=None, max_length=320)
    name: str | None = Field(default=None, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    position: str | None = Field(default=None, max_length=200)
    selected: bool | None = None

class LeadFinderSaveGroupInput(Input):
    group_name: str = Field(min_length=1, max_length=200)
    candidate_ids: list[str] | None = None
```

- [ ] **Step 3: Implement `service.py`**

`create_run`: parse brief → clamp target → insert `LeadSearchRun` (`queued`, progress defaults) → commit → `enqueue_or_run(run.id)` → return run.

`enqueue_or_run`: if `get_settings().redis_url` set, `run_lead_finder_batch.delay(run_id, batch_limit=first_batch)`; else call `run_lead_batch` inline in a new DB session (local dev fallback).

`continue_run`: only if status in `ready|cancelled` with candidates < target (or always allow if ready); set `queued`; enqueue with batch_limit = min(remaining, first_batch) or remaining toward target.

`cancel_run`: if `queued|running` → `cancelled`.

`save_group`:
1. Resolve candidates (explicit ids or `selected=True`).
2. If none → HTTP 422.
3. Allow **1+** members on this path (internal create; do not use `RecipientGroupInput` min 2).
4. For each email: reuse non-deleted recipient or create with `custom_fields={"lead_source_url": source_url}`; skip suppressed with count in `skipped`.
5. Unique group name check → 409.
6. Create `RecipientGroup` + `GroupMember`s; audit `recipient_group.created` and `lead_finder.group_saved`.
7. Return `{ group_id, group_name, created, reused, skipped }`.

- [ ] **Step 4: Celery task** in `tasks.py`:

```python
@celery.task(soft_time_limit=540, time_limit=600)
def run_lead_finder_batch(run_id: str, batch_limit: int = 20):
    with SessionLocal() as db:
        from app.lead_finder.pipeline import run_lead_batch
        run_lead_batch(db, run_id, batch_limit=batch_limit)
```

- [ ] **Step 5: API router** `backend/app/api/v1/lead_finder.py`

```python
router = APIRouter(prefix="/lead-finder", tags=["Lead Finder"])
```

Implement all spec endpoints with `current_user` / `editor`, `owned()` for runs, serialize run + candidates. List runs ordered by `created_at` desc, limit 50. PATCH candidate must verify candidate belongs to run + org.

- [ ] **Step 6: Mount router** in `backend/app/main.py`:

```python
from app.api.v1 import auth, resources, campaigns, intelligence, public, lead_finder
...
for router in (auth.router, resources.router, campaigns.router, intelligence.router, public.router, lead_finder.router):
    app.include_router(router, prefix="/api/v1")
```

- [ ] **Step 7: Run API tests**

Run: `cd backend && .venv/bin/pytest tests/test_lead_finder_api.py -v`  
Expected: PASS

Also run: `cd backend && .venv/bin/pytest tests/test_workflow.py -v -k recipient_group`  
Expected: existing group tests still PASS

---

### Task 6: Frontend Lead Finder page

**Files:**
- Create: `frontend/src/pages/LeadFinder.jsx`
- Create: `frontend/src/services/leadFinder.js` (optional; may call `api` directly like Studio)
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/layouts/Workspace.jsx`
- Modify: `frontend/src/styles/index.css` (minimal layout classes; reuse `panel`, tables, buttons)
- Test: smoke import via existing patterns if present; otherwise manual verify

**Interfaces:**
- Consumes REST from Task 5
- Route path: `/lead-finder` (App lazy route `lead-finder`)

- [ ] **Step 1: Wire route + nav**

`App.jsx`: `const LeadFinder = lazy(() => import('./pages/LeadFinder'));` and `<Route path="lead-finder" element={<LeadFinder />} />`.

`Workspace.jsx` WORKSPACE group, after AI Agent Studio:

```javascript
['Lead Finder', '/lead-finder', Search], // import Search from lucide-react
```

- [ ] **Step 2: Build page UX**

`LeadFinder.jsx` structure:
- `PageHeader` title “Lead Finder”, description about recruiter email discovery + human review
- Left/top: instruction textarea + optional number input for target count + Start button → `POST /lead-finder/runs`
- Poll active run with `useApi(`/lead-finder/runs/${id}`, { refetchInterval: status in queued|running ? 2000 : false })`
- Progress line from `run.progress`
- Table of candidates from `useApi(`/lead-finder/runs/${id}/candidates`)` — checkbox, editable name/company/position, email, source link, selected toggle via PATCH
- Buttons: Find more → `POST .../continue`; Cancel → `POST .../cancel`; Save as group → dialog for name → `POST .../save-group`
- Recent runs list from `GET /lead-finder/runs` — click to set active id
- On save success: toast with counts; links to `/recipient-groups` and `/compose`
- Empty state when no run: example prompts (“Find 20 technical recruiters in Berlin…”)
- Match existing navy/cyan workspace styles; no new purple/glow aesthetic

- [ ] **Step 3: Manual check**

Run frontend `npm run dev`, open `/lead-finder`, confirm nav highlight, empty state, and that Start without API key surfaces failed run error from backend after poll (or immediate if inline fallback fails).

---

### Task 7: Docs + Integrations status note

**Files:**
- Modify: `README.md` (Configure intelligence / features list — short Lead Finder blurb + env keys)
- Modify: `frontend/src/pages/Configuration.jsx` or Integrations page only if it already lists AI keys — add Serper/CSE as optional integration status if there is an existing pattern; otherwise README-only

- [ ] **Step 1: Document env**

README bullet:
- Lead Finder uses `LEAD_SEARCH_PROVIDER` + `SERPER_API_KEY` or `GOOGLE_CSE_API_KEY`/`GOOGLE_CSE_CX`, Celery worker for batches, human review before saving recipient groups.

- [ ] **Step 2: Final verification**

```bash
cd backend && .venv/bin/pytest tests/test_lead_finder_extract.py tests/test_lead_finder_search.py tests/test_lead_finder_pipeline.py tests/test_lead_finder_api.py -v
cd frontend && npm test -- --run  # if project has vitest scripts; otherwise skip
```

Expected: all new backend tests PASS; no Studio regressions required beyond import.

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| NL brief → structured search | Task 4 |
| Public web search + page fetch | Task 3–4 |
| Quality rules / no invented emails | Task 1 |
| Hybrid Celery + first batch ~20 | Task 4–5 |
| Review + PATCH candidates | Task 5–6 |
| Save group reuse/create recipients | Task 5 |
| Cancel / continue / errors | Task 5 |
| New `/lead-finder` page + sidebar | Task 6 |
| Studio unchanged | File map (no orchestrator edits except import helpers) |
| Config env keys | Task 1, 7 |
| Tests unit/API/worker path | Tasks 1, 3–5 |

## Self-review notes

- Hybrid clarified as immediate POST + Celery batches (matches committed spec).
- Group save allows 1+ members on Lead Finder path only (public group API still min 2).
- No placeholders left for core interfaces; Serper/CSE request JSON shapes should follow current provider docs at implement time.
