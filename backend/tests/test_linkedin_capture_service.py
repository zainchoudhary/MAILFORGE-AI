import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.linkedin_capture.schemas import CaptureCandidatePatch

from app.core.config import get_settings
from app.linkedin_capture import service
from app.models.entities import (
    AuditLog,
    LinkedInJobRaw,
    LinkedInLeadCandidate,
    Suppression,
    User,
)


@pytest.fixture
def user(account, db):
    return db.scalars(select(User)).first()


def _job(jid, **kw):
    return {"linkedin_job_id": jid, "title": "Recruiter", "company": "Acme", **kw}


def test_upsert_extract_and_idempotent(user, db):
    run = service.create_run(db, user, search_url="https://linkedin.com/jobs")
    jobs = [
        _job("1", list_payload={"snippet": "no email here"}),
        _job("2", detail_payload={"description": "Send CV to jane.doe@acme-corp.com today"}),
    ]
    out = service.upsert_jobs_batch(db, user, run.id, jobs)
    assert out["inserted"] == 2 and out["updated"] == 0
    rows = {j.linkedin_job_id: j for j in db.scalars(select(LinkedInJobRaw))}
    assert rows["2"].detail_status == "fetched"
    assert rows["1"].detail_status == "pending"
    emails = [c.email for c in db.scalars(select(LinkedInLeadCandidate))]
    assert emails == ["jane.doe@acme-corp.com"]
    db.refresh(run)
    assert run.status == "ready" and run.progress["listed"] == 2

    again = service.upsert_jobs_batch(db, user, run.id, jobs)
    assert again["inserted"] == 0 and again["updated"] == 2
    assert len(list(db.scalars(select(LinkedInLeadCandidate)))) == 1
    assert service.request_fetch_details(db, user, run.id, None)["linkedin_job_ids"] == ["1"]


def test_hard_ceiling_422(user, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "linkedin_capture_hard_ceiling", 2)
    run = service.create_run(db, user)
    service.upsert_jobs_batch(db, user, run.id, [_job("1"), _job("2")], extract=False)
    with pytest.raises(HTTPException) as exc:
        service.upsert_jobs_batch(db, user, run.id, [_job("3")], extract=False)
    assert exc.value.status_code == 422
    # re-sending existing jobs does not count against the ceiling
    service.upsert_jobs_batch(db, user, run.id, [_job("1")], extract=False)


def test_suppressed_skipped_and_save_group(user, db):
    db.add(
        Suppression(organization_id=user.organization_id, email="no@acme-corp.com", reason="x")
    )
    db.commit()
    run = service.create_run(db, user)
    text = "Contact jane.doe@acme-corp.com or no@acme-corp.com"
    out = service.upsert_jobs_batch(db, user, run.id, [_job("1", detail_payload={"d": text})])
    assert out["extract"]["skipped_suppressed"] >= 1
    cands = list(db.scalars(select(LinkedInLeadCandidate)))
    assert [c.email for c in cands] == ["jane.doe@acme-corp.com"]
    res = service.save_group(db, user, run.id, "LI group", [cands[0].id])
    assert res["recipient_count"] == 1
    assert db.scalar(select(AuditLog.id).where(AuditLog.action == "linkedin_capture.group_saved"))
    with pytest.raises(HTTPException) as exc:
        service.save_group(db, user, run.id, "LI group", [cands[0].id])
    assert exc.value.status_code == 409


def test_capture_candidate_patch_schema_rejects_bad_email():
    with pytest.raises(ValidationError):
        CaptureCandidatePatch(email="nope")
    with pytest.raises(ValidationError):
        CaptureCandidatePatch(email="")
    patch = CaptureCandidatePatch(email=" Jane@Acme.TEST ")
    assert patch.email == "jane@acme.test"


def test_patch_candidate_rejects_bad_email(user, db):
    run = service.create_run(db, user)
    service.upsert_jobs_batch(
        db, user, run.id, [_job("1", detail_payload={"d": "Contact jane.doe@acme-corp.com"})]
    )
    cand = db.scalars(select(LinkedInLeadCandidate)).first()
    with pytest.raises(HTTPException) as exc:
        service.patch_candidate(db, user, run.id, cand.id, {"email": "nope"})
    assert exc.value.status_code == 422
    db.refresh(cand)
    assert cand.email == "jane.doe@acme-corp.com"
