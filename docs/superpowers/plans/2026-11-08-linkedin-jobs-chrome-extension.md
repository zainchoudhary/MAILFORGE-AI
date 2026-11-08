# LinkedIn Jobs Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Chrome MV3 extension that captures LinkedIn Jobs pages into Outreach Studio, extracts emails only from those job-post texts, and saves leads as Recipient Groups via the LinkedIn Search workspace page.

**Architecture:** Thin MV3 extension (DOM capture + auth + upload queue) posts batches to a new `linkedin_capture` backend module. Backend stores `LinkedInCaptureRun` / `LinkedInJobRaw`, extracts emails from stored LinkedIn payloads (reusing Lead Finder extract helpers—no web search), exposes review + `save-group` APIs. Studio `LinkedInFinder` page mirrors Lead Finder review UX.

**Tech Stack:** Chrome Manifest V3, FastAPI, SQLAlchemy, Alembic, existing JWT auth, React, React Query, Vite. Optional Celery only if extract batches need async; v1 may extract synchronously on detail upsert.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-08-linkedin-jobs-chrome-extension-design.md`
- Emails in v1 come **only** from captured LinkedIn job post text — never invent; no Serper/CSE/page-fetch on this path
- No server-side LinkedIn cookies, login, or Playwright against LinkedIn
- Jobs only (not People/profiles); groups = existing Recipient Groups
- Cap: `LINKEDIN_CAPTURE_MAX_JOBS_PER_RUN` default 300, hard ceiling 500
- Do not overload `backend/app/agents/orchestrator.py` or grow `lead_finder/` with LinkedIn DOM concerns
- Do not commit unless the user explicitly asks
- Follow existing tenant `owned()` + audit patterns

## File map

| Path | Responsibility |
|---|---|
| `backend/app/linkedin_capture/__init__.py` | Package marker |
| `backend/app/linkedin_capture/schemas.py` | Pydantic request/response drafts |
| `backend/app/linkedin_capture/extract.py` | Build text from job payloads → candidates via Lead Finder extract |
| `backend/app/linkedin_capture/service.py` | Create run, batch upsert, extract, cancel, save-group |
| `backend/app/api/v1/linkedin_capture.py` | REST under `/linkedin-capture` |
| `backend/app/models/entities.py` | `LinkedInCaptureRun`, `LinkedInJobRaw`, `LinkedInLeadCandidate` |
| `backend/migrations/versions/0006_linkedin_capture.py` | Tables + indexes |
| `backend/app/core/config.py` | Capture max settings |
| `backend/app/main.py` | Mount router |
| `backend/tests/test_linkedin_capture_extract.py` | Extract unit tests |
| `backend/tests/test_linkedin_capture_api.py` | API + save-group tests |
| `extension/manifest.json` | MV3 manifest |
| `extension/src/background.js` | Auth storage, upload queue |
| `extension/src/sidepanel.html` + `sidepanel.js` | Capture UI |
| `extension/src/content/jobs.js` | List / deep / detail DOM adapters |
| `extension/src/lib/api.js` | API client |
| `extension/src/lib/selectors.js` | Versioned LinkedIn selectors |
| `extension/fixtures/*.html` | Parser fixtures |
| `extension/README.md` | Load unpacked steps |
| `frontend/src/pages/LinkedInFinder.jsx` | Runs / jobs / candidates / save-group |
| `frontend/src/services/linkedinCapture.js` | API helpers |
| `.env.example` | Document `LINKEDIN_CAPTURE_*` + extension API base |

**Order:** Tasks 1–4 backend (Studio can be tested with curl/fixtures) → Task 5–6 extension → Task 7 frontend → Task 8 docs polish.

---

### Task 1: Models, migration, settings

**Files:**
- Modify: `backend/app/models/entities.py`
- Create: `backend/migrations/versions/0006_linkedin_capture.py`
- Modify: `backend/app/core/config.py`
- Modify: `.env.example`
- Test: `backend/tests/test_linkedin_capture_models.py` (optional smoke) — prefer API tests in Task 4; for this task verify migration upgrades cleanly

**Interfaces:**
- Produces ORM classes:
  - `LinkedInCaptureRun(Tenant)`: `created_by_user_id`, `search_url`, `search_query_snapshot`, `status`, `progress` (JSON), `error`, `updated_at`
  - `LinkedInJobRaw(Tenant)`: `run_id`, `linkedin_job_id`, `title`, `company`, `location`, `job_url`, `list_payload` (JSON), `detail_payload` (JSON|null), `detail_status`; `UniqueConstraint("run_id", "linkedin_job_id")`
  - `LinkedInLeadCandidate(Tenant)`: same shape as `LeadCandidate` plus optional `job_raw_id`; `UniqueConstraint("run_id", "email")`
- Produces settings: `linkedin_capture_max_jobs_per_run: int = 300`, `linkedin_capture_hard_ceiling: int = 500`

- [ ] **Step 1: Add entity classes** after `LeadCandidate` in `backend/app/models/entities.py`

```python
class LinkedInCaptureRun(Tenant, Base):
    __tablename__ = "linkedin_capture_runs"
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    search_url: Mapped[str] = mapped_column(Text, default="")
    search_query_snapshot: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="idle", index=True)
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class LinkedInJobRaw(Tenant, Base):
    __tablename__ = "linkedin_job_raw"
    __table_args__ = (UniqueConstraint("run_id", "linkedin_job_id"),)
    run_id: Mapped[str] = mapped_column(ForeignKey("linkedin_capture_runs.id"), index=True)
    linkedin_job_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(500), default="")
    company: Mapped[str] = mapped_column(String(300), default="")
    location: Mapped[str] = mapped_column(String(300), default="")
    job_url: Mapped[str] = mapped_column(Text, default="")
    list_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    detail_payload: Mapped[dict | None] = mapped_column(JSON)
    detail_status: Mapped[str] = mapped_column(String(30), default="pending")


class LinkedInLeadCandidate(Tenant, Base):
    __tablename__ = "linkedin_lead_candidates"
    __table_args__ = (UniqueConstraint("run_id", "email"),)
    run_id: Mapped[str] = mapped_column(ForeignKey("linkedin_capture_runs.id"), index=True)
    job_raw_id: Mapped[str | None] = mapped_column(ForeignKey("linkedin_job_raw.id"))
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

- [ ] **Step 2: Write Alembic migration `0006_linkedin_capture.py`**

```python
"""Add LinkedIn capture runs, raw jobs, and lead candidates."""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "linkedin_capture_runs",
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("search_url", sa.Text(), nullable=False),
        sa.Column("search_query_snapshot", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_linkedin_capture_runs_created_by_user_id", "linkedin_capture_runs", ["created_by_user_id"])
    op.create_index("ix_linkedin_capture_runs_status", "linkedin_capture_runs", ["status"])
    op.create_index("ix_linkedin_capture_runs_organization_id", "linkedin_capture_runs", ["organization_id"])
    op.create_index("ix_linkedin_capture_runs_created_at", "linkedin_capture_runs", ["created_at"])

    op.create_table(
        "linkedin_job_raw",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("linkedin_job_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("company", sa.String(length=300), nullable=False),
        sa.Column("location", sa.String(length=300), nullable=False),
        sa.Column("job_url", sa.Text(), nullable=False),
        sa.Column("list_payload", sa.JSON(), nullable=False),
        sa.Column("detail_payload", sa.JSON(), nullable=True),
        sa.Column("detail_status", sa.String(length=30), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["linkedin_capture_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "linkedin_job_id"),
    )
    op.create_index("ix_linkedin_job_raw_run_id", "linkedin_job_raw", ["run_id"])
    op.create_index("ix_linkedin_job_raw_organization_id", "linkedin_job_raw", ["organization_id"])
    op.create_index("ix_linkedin_job_raw_created_at", "linkedin_job_raw", ["created_at"])

    op.create_table(
        "linkedin_lead_candidates",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("job_raw_id", sa.String(length=36), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("company", sa.String(length=200), nullable=False),
        sa.Column("position", sa.String(length=200), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_title", sa.String(length=500), nullable=False),
        sa.Column("snippet", sa.Text(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("signals", sa.JSON(), nullable=False),
        sa.Column("selected", sa.Boolean(), nullable=False),
        sa.Column("existing_recipient_id", sa.String(length=36), nullable=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["existing_recipient_id"], ["recipients.id"]),
        sa.ForeignKeyConstraint(["job_raw_id"], ["linkedin_job_raw.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["linkedin_capture_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "email"),
    )
    op.create_index("ix_linkedin_lead_candidates_run_id", "linkedin_lead_candidates", ["run_id"])
    op.create_index("ix_linkedin_lead_candidates_organization_id", "linkedin_lead_candidates", ["organization_id"])
    op.create_index("ix_linkedin_lead_candidates_created_at", "linkedin_lead_candidates", ["created_at"])


def downgrade():
    op.drop_index("ix_linkedin_lead_candidates_created_at", table_name="linkedin_lead_candidates")
    op.drop_index("ix_linkedin_lead_candidates_organization_id", table_name="linkedin_lead_candidates")
    op.drop_index("ix_linkedin_lead_candidates_run_id", table_name="linkedin_lead_candidates")
    op.drop_table("linkedin_lead_candidates")
    op.drop_index("ix_linkedin_job_raw_created_at", table_name="linkedin_job_raw")
    op.drop_index("ix_linkedin_job_raw_organization_id", table_name="linkedin_job_raw")
    op.drop_index("ix_linkedin_job_raw_run_id", table_name="linkedin_job_raw")
    op.drop_table("linkedin_job_raw")
    op.drop_index("ix_linkedin_capture_runs_created_at", table_name="linkedin_capture_runs")
    op.drop_index("ix_linkedin_capture_runs_organization_id", table_name="linkedin_capture_runs")
    op.drop_index("ix_linkedin_capture_runs_status", table_name="linkedin_capture_runs")
    op.drop_index("ix_linkedin_capture_runs_created_by_user_id", table_name="linkedin_capture_runs")
    op.drop_table("linkedin_capture_runs")
```

- [ ] **Step 3: Add settings**

In `backend/app/core/config.py` on `Settings`:

```python
linkedin_capture_max_jobs_per_run: int = 300
linkedin_capture_hard_ceiling: int = 500
```

In `.env.example` add:

```
LINKEDIN_CAPTURE_MAX_JOBS_PER_RUN=300
LINKEDIN_CAPTURE_HARD_CEILING=500
```

- [ ] **Step 4: Run migration (dev DB)**

Run: `cd backend && .venv/bin/alembic upgrade head`  
Expected: `0006` applied without error

- [ ] **Step 5: Commit only if user asks** — otherwise stop after green migration

---

### Task 2: Extract emails from LinkedIn job payloads

**Files:**
- Create: `backend/app/linkedin_capture/__init__.py`
- Create: `backend/app/linkedin_capture/schemas.py`
- Create: `backend/app/linkedin_capture/extract.py`
- Test: `backend/tests/test_linkedin_capture_extract.py`

**Interfaces:**
- Consumes: `app.lead_finder.extract.extract_candidates_from_text`, `normalize_email`, `is_hard_rejected_email`
- Produces:
  - `job_text_for_extract(job: dict | LinkedInJobRaw-like) -> str`
  - `extract_from_job(*, title, company, location, job_url, list_payload, detail_payload) -> list[CandidateDraft]`  
    Company fallback: if draft has empty company, set to job `company`.  
    `source_url` = `job_url`.  
    `signals["source"] = "linkedin_job_post"`.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_linkedin_capture_extract.py
from app.linkedin_capture.extract import extract_from_job, job_text_for_extract

def test_extracts_email_from_detail_description():
    drafts = extract_from_job(
        title="Backend Engineer",
        company="Acme Corp",
        location="Remote",
        job_url="https://www.linkedin.com/jobs/view/123",
        list_payload={"snippet": "Great role"},
        detail_payload={
            "description": "Apply via hiring@acme.com or message our TA team.",
        },
    )
    assert len(drafts) == 1
    assert drafts[0].email == "hiring@acme.com"
    assert drafts[0].company  # from job company if name missing
    assert drafts[0].source_url.endswith("/123")
    assert drafts[0].signals.get("source") == "linkedin_job_post"

def test_no_email_means_empty():
    drafts = extract_from_job(
        title="Engineer",
        company="Acme",
        location="",
        job_url="https://www.linkedin.com/jobs/view/9",
        list_payload={},
        detail_payload={"description": "No contact listed. Easy Apply only."},
    )
    assert drafts == []

def test_noreply_excluded():
    drafts = extract_from_job(
        title="Role",
        company="Acme",
        location="",
        job_url="https://www.linkedin.com/jobs/view/1",
        list_payload={},
        detail_payload={"description": "noreply@acme.com and real jane@acme.com"},
    )
    assert all(d.email != "noreply@acme.com" for d in drafts)
    assert any(d.email == "jane@acme.com" for d in drafts)

def test_job_text_includes_list_and_detail():
    text = job_text_for_extract(
        {
            "title": "T",
            "company": "C",
            "list_payload": {"snippet": "list-bit"},
            "detail_payload": {"description": "detail-bit"},
        }
    )
    assert "list-bit" in text and "detail-bit" in text
```

- [ ] **Step 2: Run tests — expect fail**

Run: `cd backend && .venv/bin/pytest tests/test_linkedin_capture_extract.py -v`  
Expected: FAIL import error

- [ ] **Step 3: Implement extract module**

```python
# backend/app/linkedin_capture/extract.py
from __future__ import annotations

from app.lead_finder.extract import extract_candidates_from_text
from app.lead_finder.schemas import CandidateDraft


def job_text_for_extract(job: dict) -> str:
    parts: list[str] = []
    for key in ("title", "company", "location"):
        val = (job.get(key) or "").strip()
        if val:
            parts.append(val)
    list_payload = job.get("list_payload") or {}
    detail_payload = job.get("detail_payload") or {}
    for blob in (list_payload, detail_payload):
        if isinstance(blob, dict):
            for v in blob.values():
                if isinstance(v, str) and v.strip():
                    parts.append(v)
        elif isinstance(blob, str) and blob.strip():
            parts.append(blob)
    return "\n".join(parts)


def extract_from_job(
    *,
    title: str,
    company: str,
    location: str,
    job_url: str,
    list_payload: dict | None,
    detail_payload: dict | None,
) -> list[CandidateDraft]:
    text = job_text_for_extract(
        {
            "title": title,
            "company": company,
            "location": location,
            "list_payload": list_payload or {},
            "detail_payload": detail_payload or {},
        }
    )
    drafts = extract_candidates_from_text(
        text, source_url=job_url or "", source_title=title or "", snippet=text[:400]
    )
    out: list[CandidateDraft] = []
    for d in drafts:
        signals = dict(d.signals or {})
        signals["source"] = "linkedin_job_post"
        company_val = d.company or company or ""
        # CandidateDraft is likely a dataclass/pydantic — reconstruct per existing schema
        out.append(
            CandidateDraft(
                email=d.email,
                name=d.name,
                company=company_val,
                position=d.position or title or "",
                source_url=job_url or d.source_url,
                source_title=title or d.source_title,
                snippet=d.snippet,
                score=d.score,
                signals=signals,
                selected=d.selected if (d.name or company_val) else False,
            )
        )
    return out
```

Adjust `CandidateDraft` construction to match the real fields in `backend/app/lead_finder/schemas.py`.

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && .venv/bin/pytest tests/test_linkedin_capture_extract.py -v`  
Expected: PASS

---

### Task 3: Service layer (create, batch upsert, extract, save-group)

**Files:**
- Create: `backend/app/linkedin_capture/schemas.py` (request bodies if not done)
- Create: `backend/app/linkedin_capture/service.py`
- Test: covered primarily in Task 4 API tests; add focused unit tests here if upsert logic is non-trivial

**Interfaces:**
- Produces:
  - `create_run(db, user, *, search_url: str = "", search_query_snapshot: str = "") -> LinkedInCaptureRun`
  - `upsert_jobs_batch(db, user, run_id: str, jobs: list[dict], *, extract: bool = True) -> dict`  
    Each job dict: `linkedin_job_id`, `title`, `company`, `location`, `job_url`, `list_payload`, optional `detail_payload` / `detail_status`.  
    Enforce max jobs via settings; reject when `len(existing)+new > hard_ceiling` with 422.  
    On detail present: set `detail_status="fetched"` and run extract for that job.
  - `request_fetch_details(db, user, run_id: str, job_ids: list[str] | None) -> dict`  
    Marks selected jobs `detail_status="pending"` (extension polls/reads this list) OR returns ids needing detail; prefer returning `{ "job_ids": [...] }` of jobs still pending/failed for extension to scrape.
  - `extract_run(db, user, run_id: str, job_raw_ids: list[str] | None = None) -> dict`  
    Idempotent: upsert candidates by email; set run status `extracting` → `ready`.
  - `save_group(db, user, run_id, group_name, candidate_ids)` — copy Lead Finder `save_group` but use `LinkedInLeadCandidate` / audit action `linkedin_capture.group_saved`
  - `list_runs`, `get_run`, `list_jobs`, `list_candidates`, `patch_candidate`, `cancel_run`

- [ ] **Step 1: Implement `service.py`** following `backend/app/lead_finder/service.py` patterns (`owned`, `audit`, suppression reuse, recipient revive).

Key upsert sketch:

```python
def upsert_jobs_batch(db, user, run_id: str, jobs: list[dict], *, extract: bool = True) -> dict:
    run = owned(db, LinkedInCaptureRun, run_id, user.organization_id)
    settings = get_settings()
    # load existing count; if would exceed hard_ceiling → HTTPException 422
    inserted = updated = 0
    touched_ids: list[str] = []
    for raw in jobs:
        jid = str(raw.get("linkedin_job_id") or "").strip()
        if not jid:
            continue
        # get-or-create LinkedInJobRaw by (run_id, linkedin_job_id)
        # merge list_payload; if detail_payload provided, store + detail_status fetched
        touched_ids.append(job.id)
    run.status = "idle"
    run.progress = {**(run.progress or {}), "listed": <count>, "message": "Synced"}
    db.commit()
    extract_stats = {}
    if extract and touched_ids:
        extract_stats = extract_run(db, user, run_id, job_raw_ids=touched_ids)
    return {"inserted": inserted, "updated": updated, "extract": extract_stats}
```

- [ ] **Step 2: Implement `save_group`** by adapting Lead Finder’s function (same 422/409 behavior, `custom_fields.lead_source_url`).

- [ ] **Step 3: Sanity-check imports**

Run: `cd backend && .venv/bin/python -c "from app.linkedin_capture import service"`  
Expected: no ImportError

---

### Task 4: REST API + tests

**Files:**
- Create: `backend/app/api/v1/linkedin_capture.py`
- Modify: `backend/app/main.py` (import + include router)
- Create: `backend/tests/test_linkedin_capture_api.py`

**Interfaces:**
- Router prefix: `/linkedin-capture`
- Auth: `Depends(editor)` for writes; `Depends(current_user)` for reads (match lead_finder)
- Routes as in spec (`/runs`, `/runs/{id}/jobs/batch`, `/jobs/fetch-details`, `/extract`, `/candidates`, `/save-group`, `/cancel`)

- [ ] **Step 1: Write failing API tests** (mirror `test_lead_finder_api.py` fixtures: `client`, `account`, `db`)

```python
# backend/tests/test_linkedin_capture_api.py
BASE = "/api/v1/linkedin-capture"

def test_create_batch_extract_and_save_group(client, account, db):
    res = client.post(f"{BASE}/runs", headers=account, json={"search_url": "https://www.linkedin.com/jobs/search/?keywords=engineer"})
    assert res.status_code == 201
    run_id = res.json()["id"]

    batch = client.post(
        f"{BASE}/runs/{run_id}/jobs/batch",
        headers=account,
        json={
            "jobs": [
                {
                    "linkedin_job_id": "111",
                    "title": "Engineer",
                    "company": "Acme",
                    "location": "NY",
                    "job_url": "https://www.linkedin.com/jobs/view/111",
                    "list_payload": {"snippet": "hi"},
                    "detail_payload": {"description": "Email careers-real@acme.test about this role."},
                }
            ]
        },
    )
    assert batch.status_code == 200
    cands = client.get(f"{BASE}/runs/{run_id}/candidates", headers=account)
    assert cands.status_code == 200
    rows = cands.json()["items"] if isinstance(cands.json(), dict) else cands.json()
    assert any("acme.test" in (r.get("email") or "") for r in rows)

    # select + save
    # patch selected true if needed
    save = client.post(
        f"{BASE}/runs/{run_id}/save-group",
        headers=account,
        json={"group_name": "LI Acme Leads"},
    )
    assert save.status_code == 200
    assert save.json()["group_id"]


def test_batch_respects_hard_ceiling(client, account, db, monkeypatch):
    from app.core.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "linkedin_capture_hard_ceiling", 2)
    monkeypatch.setattr(settings, "linkedin_capture_max_jobs_per_run", 2)
    run_id = client.post(f"{BASE}/runs", headers=account, json={}).json()["id"]
    jobs = [
        {
            "linkedin_job_id": str(i),
            "title": "T",
            "company": "C",
            "location": "",
            "job_url": f"https://www.linkedin.com/jobs/view/{i}",
            "list_payload": {},
        }
        for i in range(3)
    ]
    res = client.post(f"{BASE}/runs/{run_id}/jobs/batch", headers=account, json={"jobs": jobs})
    assert res.status_code == 422


def test_org_isolation(client, account, other_account, db):
    run_id = client.post(f"{BASE}/runs", headers=account, json={}).json()["id"]
    res = client.get(f"{BASE}/runs/{run_id}", headers=other_account)
    assert res.status_code == 404
```


Match exact response envelope used by lead_finder (`items` vs list)—inspect `lead_finder.py` and stay consistent.

- [ ] **Step 2: Run tests — expect fail**

Run: `cd backend && .venv/bin/pytest tests/test_linkedin_capture_api.py -v`  
Expected: FAIL (router missing)

- [ ] **Step 3: Implement router + mount**

```python
# backend/app/api/v1/linkedin_capture.py
from fastapi import APIRouter, Depends
from app.security.auth import current_user, editor
from app.database.session import get_db
from app.linkedin_capture import service

router = APIRouter(prefix="/linkedin-capture", tags=["LinkedIn Capture"])

@router.post("/runs", status_code=201)
def create_run(body: dict, user=Depends(editor), db=Depends(get_db)):
    run = service.create_run(db, user, search_url=body.get("search_url", ""), search_query_snapshot=body.get("search_query_snapshot", ""))
    return service.serialize_run(run)  # or repositories.serialize
```

In `backend/app/main.py`:

```python
from app.api.v1 import auth, resources, campaigns, intelligence, public, lead_finder, linkedin_capture
# ...
for router in (..., lead_finder.router, linkedin_capture.router):
    app.include_router(router, prefix="/api/v1")
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && .venv/bin/pytest tests/test_linkedin_capture_api.py tests/test_linkedin_capture_extract.py -v`  
Expected: PASS

- [ ] **Step 5: Run lead_finder regression**

Run: `cd backend && .venv/bin/pytest tests/test_lead_finder_api.py -v`  
Expected: PASS

---

### Task 5: Extension scaffold + auth + list capture

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/src/background.js`
- Create: `extension/src/sidepanel.html`
- Create: `extension/src/sidepanel.js`
- Create: `extension/src/lib/api.js`
- Create: `extension/src/lib/selectors.js`
- Create: `extension/src/content/jobs.js`
- Create: `extension/fixtures/jobs-list.html`
- Create: `extension/README.md` (minimal load steps; expand in Task 8)
- Test: parser unit via Node or plain assert script — `extension/scripts/test_parsers.mjs` reading fixtures

**Interfaces:**
- Auth: email/password → `POST {apiBase}/api/v1/auth/login`; store `access_token` + `refresh_token` in `chrome.storage.local`; refresh via existing `/auth/refresh`
- `api.createRun`, `api.batchJobs(runId, jobs)`
- Content script message API: `{ type: "CAPTURE_VISIBLE" }` → array of job cards
- Selectors isolated in `selectors.js` (`JOB_CARD`, `TITLE`, `COMPANY`, `LINK`, …)

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Outreach Studio — LinkedIn Jobs Capture",
  "version": "0.1.0",
  "description": "Capture LinkedIn Jobs into Outreach Studio",
  "permissions": ["storage", "sidePanel", "activeTab", "scripting"],
  "host_permissions": [
    "https://www.linkedin.com/jobs/*",
    "http://localhost:8000/*",
    "https://*/*"
  ],
  "background": { "service_worker": "src/background.js", "type": "module" },
  "side_panel": { "default_path": "src/sidepanel.html" },
  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/jobs/*"],
      "js": ["src/content/jobs.js"],
      "run_at": "document_idle"
    }
  ],
  "action": { "default_title": "Outreach Studio Capture" }
}
```

Tighten `host_permissions` to the real API origin via options page config (`apiBase`); avoid open `https://*/*` in final form—use optional host permission or options-stored origin + `permissions` request.

- [ ] **Step 2: Implement `api.js` + background token refresh**

```javascript
// extension/src/lib/api.js
export async function login(apiBase, email, password) {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { access_token, refresh_token, token_type }
}
```

Background listens for `LOGIN`, `CAPTURE_VISIBLE`, `START_RUN`, queues `jobs/batch` posts with Bearer token.

- [ ] **Step 3: Implement list parser + fixture test**

```javascript
// extension/src/lib/selectors.js
export const SELECTORS = {
  jobCard: ".jobs-search-results__list-item, .scaffold-layout__list-item",
  title: ".job-card-list__title, a.job-card-container__link",
  company: ".job-card-container__primary-description, .job-card-container__company-name",
  location: ".job-card-container__metadata-item",
  link: "a.job-card-container__link, a.job-card-list__title",
};

// content/jobs.js: parseVisibleJobs() → [{ linkedin_job_id, title, company, location, job_url, list_payload }]
// Derive linkedin_job_id from /jobs/view/(\d+)/ or data-job-id attributes
```

Fixture HTML should include 2 fake cards; `test_parsers.mjs` uses JSDOM or linkedom if added as devDep—or keep a tiny regex-based extractor tested against fixture strings without full Chrome.

- [ ] **Step 4: Side panel UI** — fields: API base, email, password, Login, Capture visible, progress count, Open Studio link (`{publicUrl}/lead-finder/linkedin?run={id}`)

- [ ] **Step 5: Manual smoke** — Load unpacked; login against local API; capture visible cards on a LinkedIn Jobs tab (dev only)

---

### Task 6: Deep capture + on-demand detail fetch

**Files:**
- Modify: `extension/src/content/jobs.js`
- Modify: `extension/src/background.js`
- Modify: `extension/src/sidepanel.js`
- Create: `extension/fixtures/job-detail.html`

**Interfaces:**
- `startDeepCapture({ maxJobs, delayMs })` — scroll/paginate until max, stop on message `STOP`, CAPTCHA heuristic (body text includes “checkpoint” / unusual challenge URL), or cap
- `fetchDetailsFor(jobIds)` — navigate or click each job in the split pane, read description DOM, return `detail_payload: { description, raw_text }`
- After each batch/detail, call `jobs/batch` with payloads

- [ ] **Step 1: Deep capture loop**

```javascript
async function deepCapture({ maxJobs = 300, delayMs = 800, onBatch }) {
  const seen = new Set();
  while (seen.size < maxJobs) {
    if (await shouldStop()) break;
    const batch = parseVisibleJobs().filter((j) => !seen.has(j.linkedin_job_id));
    batch.forEach((j) => seen.add(j.linkedin_job_id));
    if (batch.length) await onBatch(batch);
    const moved = await scrollOrNextPage();
    if (!moved) break;
    await sleep(delayMs);
  }
  return seen.size;
}
```

- [ ] **Step 2: Detail scrape**

Read description from known containers (e.g. `.jobs-description__content`, `#job-details`). Always send full text in `detail_payload.description`.

- [ ] **Step 3: Wire side panel buttons** — Deep capture, Stop, Fetch details for selected / all pending

- [ ] **Step 4: Fixture test for detail text extraction** — assert email string survives into `detail_payload`

---

### Task 7: Studio LinkedIn Search UI

**Files:**
- Modify: `frontend/src/pages/LinkedInFinder.jsx`
- Create: `frontend/src/services/linkedinCapture.js`
- Modify: `frontend/src/styles/index.css` only if needed (reuse Lead Finder classes where possible)
- Route already exists in `App.jsx` / `Workspace.jsx`

**Interfaces:**
- Service helpers mirror `frontend/src/services/leadFinder.js`: `listRuns`, `getRun`, `listJobs`, `listCandidates`, `patchCandidate`, `saveGroup`, `extractRun`, `cancelRun`
- Page: empty state (install extension instructions), recent runs, jobs table with `detail_status`, candidates table, Save as group dialog

- [ ] **Step 1: Create `linkedinCapture.js`** with paths under `/linkedin-capture/...`

- [ ] **Step 2: Replace placeholder `LinkedInFinder.jsx`** — reuse patterns from `LeadFinder.jsx` (polling, CandidateRow, Dialog save). Remove chat/prompt UI; show capture-oriented copy.

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && npm test -- --run routeSmoke` (or project’s existing test command)  
Expected: route still loads; fix imports if smoke fails

- [ ] **Step 4: Manual UI check** — with seeded run from API tests / extension, verify candidates + save-group lands in Recipient Groups

---

### Task 8: Docs + config polish

**Files:**
- Modify: `extension/README.md`
- Modify: `README.md` or `EASY_GUIDE_ROMAN_URDU.md` (short section: load unpacked, set API base, capture flow)
- Modify: `.env.example` if anything missing

- [ ] **Step 1: Document** Chrome → Extensions → Load unpacked → select `extension/`; set API base to backend; sign in; open LinkedIn Jobs; Capture / Deep / Fetch details; review in Studio LinkedIn Search; Save group

- [ ] **Step 2: Note limits** — emails only if present on the job post; LinkedIn DOM may break selectors (point to `selectors.js`)

- [ ] **Step 3: Final regression**

```bash
cd backend && .venv/bin/pytest tests/test_linkedin_capture_extract.py tests/test_linkedin_capture_api.py tests/test_lead_finder_api.py -v
cd frontend && npm test -- --run
```

Expected: all PASS

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| MV3 extension, Jobs-only capture | 5–6 |
| Hybrid incremental + Deep capture | 5–6 |
| List then on-demand detail | 3, 6 |
| Raw jobs in shared DB | 1, 3–4 |
| Emails only from LinkedIn post text | 2, 3 |
| No public-web Find contacts | Global + Task 2 (no search/fetch calls) |
| OAuth/session → Studio token | 5 (login + refresh via existing auth) |
| Dual UI (side panel + Studio) | 5–7 |
| Recipient Group save | 3–4, 7 |
| Org isolation / owned() | 3–4 |
| Caps 300/500 | 1, 3–4 |
| Selector adapter isolation | 5 (`selectors.js`) |
| No LinkedIn cookies on server | Global + architecture |

No TBD placeholders left in task steps. Types: `LinkedInCaptureRun` / `LinkedInJobRaw` / `LinkedInLeadCandidate` naming is consistent across tasks. `CandidateDraft` construction must match `lead_finder.schemas` at implement time.
