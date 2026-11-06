from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select

from app.database.session import get_db
from app.lead_finder import service
from app.lead_finder.extract import normalize_email
from app.models.entities import LeadCandidate, LeadSearchRun, Recipient, Suppression
from app.repositories.common import audit, owned, page, serialize
from app.schemas.inputs import LeadCandidatePatch, LeadFinderRunInput, LeadFinderSaveGroupInput
from app.security.auth import current_user, editor

router = APIRouter(prefix="/lead-finder", tags=["Lead Finder"])


def run_payload(db, run, count=None):
    return {
        **serialize(run),
        "candidate_count": service.candidate_count(db, run.id) if count is None else count,
    }


@router.post("/runs", status_code=201)
def create_run(data: LeadFinderRunInput, user=Depends(editor), db=Depends(get_db)):
    run = service.create_run(db, user, data.instruction, data.target_count)
    return run_payload(db, run)


@router.get("/runs")
def list_runs(user=Depends(current_user), db=Depends(get_db)):
    runs = list(
        db.scalars(
            select(LeadSearchRun)
            .where(LeadSearchRun.organization_id == user.organization_id)
            .order_by(LeadSearchRun.created_at.desc())
            .limit(50)
        )
    )
    counts = dict(
        db.execute(
            select(LeadCandidate.run_id, func.count())
            .where(
                LeadCandidate.organization_id == user.organization_id,
                LeadCandidate.run_id.in_([r.id for r in runs]),
            )
            .group_by(LeadCandidate.run_id)
        ).all()
    )
    return {"items": [run_payload(db, r, counts.get(r.id, 0)) for r in runs]}


@router.get("/runs/{run_id}")
def get_run(run_id: str, user=Depends(current_user), db=Depends(get_db)):
    return run_payload(db, owned(db, LeadSearchRun, run_id, user.organization_id))


@router.get("/runs/{run_id}/candidates")
def list_candidates(
    run_id: str,
    page_number: int = Query(1, ge=1, alias="page"),
    limit: int = Query(100, ge=1, le=200),
    user=Depends(current_user),
    db=Depends(get_db),
):
    owned(db, LeadSearchRun, run_id, user.organization_id)
    return page(
        db,
        LeadCandidate,
        user.organization_id,
        page_number,
        limit,
        [LeadCandidate.run_id == run_id],
        order=(LeadCandidate.score.desc(), LeadCandidate.email),
    )


@router.patch("/runs/{run_id}/candidates/{candidate_id}")
def patch_candidate(
    run_id: str,
    candidate_id: str,
    data: LeadCandidatePatch,
    user=Depends(editor),
    db=Depends(get_db),
):
    org = user.organization_id
    owned(db, LeadSearchRun, run_id, org)
    candidate = owned(db, LeadCandidate, candidate_id, org)
    if candidate.run_id != run_id:
        raise HTTPException(404, "Record not found")
    changes = data.model_dump(exclude_unset=True)
    if changes.get("email") is None:
        changes.pop("email", None)
    for field in ("name", "company", "position"):
        if field in changes:
            changes[field] = (changes[field] or "").strip()
    if "selected" in changes and changes["selected"] is None:
        changes.pop("selected")
    if "email" in changes:
        email = normalize_email(changes["email"])
        changes["email"] = email
        if email != candidate.email:
            if db.scalar(
                select(LeadCandidate.id).where(
                    LeadCandidate.run_id == run_id, LeadCandidate.email == email
                )
            ):
                raise HTTPException(409, "Another lead in this run already uses that email")
            candidate.existing_recipient_id = db.scalar(
                select(Recipient.id).where(
                    Recipient.organization_id == org,
                    Recipient.email == email,
                    Recipient.deleted.is_(False),
                )
            )
    final_email = changes.get("email", candidate.email)
    suppressed = db.scalar(
        select(Suppression.id).where(
            Suppression.organization_id == org, Suppression.email == final_email
        )
    )
    if suppressed and changes.get("selected"):
        raise HTTPException(422, "This email is on the suppression list and cannot be selected")
    edited = {
        field
        for field in ("name", "company", "position")
        if field in changes and changes[field] != (getattr(candidate, field) or "")
    }
    if edited:
        signals = dict(candidate.signals or {})
        signals["user_edited"] = sorted(edited | set(signals.get("user_edited") or []))
        candidate.signals = signals
    for key, value in changes.items():
        setattr(candidate, key, value)
    if suppressed:
        candidate.selected = False
    audit(db, user, "lead_finder.candidate_updated", candidate.id, {"fields": sorted(changes)})
    db.commit()
    return serialize(candidate)


@router.post("/runs/{run_id}/continue")
def continue_run(run_id: str, user=Depends(editor), db=Depends(get_db)):
    return run_payload(db, service.continue_run(db, user, run_id))


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, user=Depends(editor), db=Depends(get_db)):
    return run_payload(db, service.cancel_run(db, user, run_id))


@router.post("/runs/{run_id}/save-group", status_code=201)
def save_group(
    run_id: str, data: LeadFinderSaveGroupInput, user=Depends(editor), db=Depends(get_db)
):
    return service.save_group(db, user, run_id, data.group_name, data.candidate_ids)
