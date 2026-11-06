"""Lead Finder service layer: run lifecycle, enqueueing and saving leads as a recipient group."""

import logging

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database.session import SessionLocal
from app.lead_finder.brief import parse_lead_brief
from app.lead_finder.pipeline import run_lead_batch
from app.models.entities import (
    GroupMember,
    LeadCandidate,
    LeadSearchRun,
    Recipient,
    RecipientGroup,
    Suppression,
)
from app.repositories.common import audit, owned

logger = logging.getLogger(__name__)


def _cap() -> int:
    return max(1, get_settings().lead_finder_max_per_run)


def _first_batch() -> int:
    return max(1, get_settings().lead_finder_first_batch)


def candidate_count(db: Session, run_id: str) -> int:
    return db.scalar(
        select(func.count()).select_from(LeadCandidate).where(LeadCandidate.run_id == run_id)
    ) or 0


def create_run(db: Session, user, instruction: str, target_count: int | None) -> LeadSearchRun:
    brief = parse_lead_brief(instruction, target_count_override=target_count)
    target = max(1, min(int(brief.target_count), _cap()))
    brief = brief.model_copy(update={"target_count": target})
    run = LeadSearchRun(
        organization_id=user.organization_id,
        created_by_user_id=user.id,
        instruction=instruction,
        brief=brief.model_dump(),
        status="queued",
        target_count=target,
        progress={
            "batch_generation": 1,
            "queries_done": 0,
            "pages_fetched": 0,
            "candidates_kept": 0,
            "message": "Queued",
            "warning": "",
        },
    )
    db.add(run)
    db.flush()
    audit(db, user, "lead_finder.run_created", run.id, {"target_count": target})
    db.commit()
    # Chunk size is first_batch; workers auto-continue until target or search stalls.
    enqueue_or_run(run.id, batch_limit=min(target, _first_batch()), generation=1)
    db.refresh(run)
    return run


WORKER_UNAVAILABLE = "Lead Finder worker unavailable; please try again shortly"
_MAX_AUTO_BATCHES = 40


def enqueue_or_run(
    run_id: str, batch_limit: int | None = None, generation: int | None = None
) -> None:
    """Hand the run to Celery. Runs inline only when no broker is configured (local dev);
    a configured but unreachable broker marks the run failed instead of blocking the request.

    After each successful batch, ``schedule_next_batch_if_needed`` (Celery) or the inline
    loop below keeps going until ``target_count`` is reached or a batch finds nothing new.
    """
    limit = batch_limit if batch_limit is not None else _first_batch()
    if not get_settings().redis_url:
        _run_batches_inline(run_id, limit=limit, generation=generation)
        return
    try:
        from app.workers.tasks import run_lead_finder_batch

        run_lead_finder_batch.delay(run_id, batch_limit=limit, generation=generation)
    except Exception:
        logger.warning("Lead Finder broker unavailable; marking run failed", exc_info=True)
        _mark_worker_unavailable(run_id, generation)


def _run_batches_inline(run_id: str, *, limit: int, generation: int | None) -> None:
    """Local-dev path: keep running batches until the target is met or search stalls."""
    gen = generation
    chunk = limit
    with SessionLocal() as session:
        for _ in range(_MAX_AUTO_BATCHES):
            before = candidate_count(session, run_id)
            run_lead_batch(session, run_id, batch_limit=chunk, generation=gen)
            session.expire_all()
            run = session.get(LeadSearchRun, run_id)
            if run is None:
                return
            after = candidate_count(session, run_id)
            if run.status != "ready" or after >= run.target_count:
                return
            if after <= before:
                progress = dict(run.progress or {})
                run.progress = {
                    **progress,
                    "message": f"Found {after} of {run.target_count}; no more new leads from search",
                }
                session.commit()
                return
            gen = int((run.progress or {}).get("batch_generation") or 0) + 1
            chunk = min(run.target_count - after, _first_batch())
            run.status = "queued"
            run.progress = {
                **(run.progress or {}),
                "batch_generation": gen,
                "auto_batches": int((run.progress or {}).get("auto_batches") or 0) + 1,
                "message": f"Continuing toward {run.target_count}…",
                "warning": "",
            }
            session.commit()


def schedule_next_batch_if_needed(run_id: str, kept_before: int, generation: int | None) -> None:
    """After a Celery batch, queue another chunk if the target is not met and progress was made."""
    with SessionLocal() as session:
        run = session.get(LeadSearchRun, run_id)
        if run is None or run.status != "ready":
            return
        progress = dict(run.progress or {})
        if generation is not None and progress.get("batch_generation") != generation:
            return
        kept = candidate_count(session, run.id)
        if kept >= run.target_count:
            return
        if kept <= kept_before:
            run.progress = {
                **progress,
                "message": f"Found {kept} of {run.target_count}; no more new leads from search",
            }
            session.commit()
            return
        auto = int(progress.get("auto_batches") or 0)
        if auto >= _MAX_AUTO_BATCHES:
            run.progress = {
                **progress,
                "message": f"Found {kept} of {run.target_count}; stopped after {_MAX_AUTO_BATCHES} search rounds",
            }
            session.commit()
            return
        next_gen = int(progress.get("batch_generation") or 0) + 1
        remaining = run.target_count - kept
        run.status = "queued"
        run.error = None
        run.progress = {
            **progress,
            "batch_generation": next_gen,
            "auto_batches": auto + 1,
            "message": f"Continuing toward {run.target_count}…",
            "warning": "",
        }
        session.commit()
        enqueue_or_run(
            run.id, batch_limit=min(remaining, _first_batch()), generation=next_gen
        )


def _mark_worker_unavailable(run_id: str, generation: int | None) -> None:
    with SessionLocal() as session:
        run = session.get(LeadSearchRun, run_id)
        if run is None or run.status not in ("queued", "running"):
            return
        progress = dict(run.progress or {})
        if generation is not None and progress.get("batch_generation") != generation:
            return
        run.status = "failed"
        run.error = WORKER_UNAVAILABLE
        run.progress = {**progress, "message": WORKER_UNAVAILABLE}
        session.commit()


def continue_run(db: Session, user, run_id: str) -> LeadSearchRun:
    run = owned(db, LeadSearchRun, run_id, user.organization_id)
    if run.status not in ("ready", "cancelled"):
        raise HTTPException(409, f"A {run.status} run cannot be continued")
    cap = _cap()
    remaining = run.target_count - candidate_count(db, run.id)
    if remaining <= 0:
        # "Find more" after reaching the target widens it by one preview batch (up to the cap).
        extended = min(cap, run.target_count + _first_batch())
        if extended <= run.target_count:
            raise HTTPException(409, "This run already reached the maximum lead count")
        run.target_count = extended
        remaining = extended - candidate_count(db, run.id)
    progress = dict(run.progress or {})
    generation = int(progress.get("batch_generation") or 0) + 1
    run.status = "queued"
    run.error = None
    run.progress = {
        **progress,
        "batch_generation": generation,
        "message": "Queued to find more leads",
        "warning": "",
    }
    audit(db, user, "lead_finder.run_continued", run.id, {"target_count": run.target_count})
    db.commit()
    enqueue_or_run(run.id, batch_limit=min(remaining, _first_batch()), generation=generation)
    db.refresh(run)
    return run


def cancel_run(db: Session, user, run_id: str) -> LeadSearchRun:
    run = owned(db, LeadSearchRun, run_id, user.organization_id)
    if run.status not in ("queued", "running"):
        raise HTTPException(409, f"A {run.status} run cannot be cancelled")
    run.status = "cancelled"
    run.progress = {**(run.progress or {}), "message": "Cancelled; partial candidates kept"}
    audit(db, user, "lead_finder.run_cancelled", run.id)
    db.commit()
    return run


def save_group(
    db: Session, user, run_id: str, group_name: str, candidate_ids: list[str] | None
) -> dict:
    org = user.organization_id
    run = owned(db, LeadSearchRun, run_id, org)
    group_name = (group_name or "").strip()
    if not group_name:
        raise HTTPException(422, "Group name is required")
    query = select(LeadCandidate).where(
        LeadCandidate.run_id == run.id, LeadCandidate.organization_id == org
    )
    if candidate_ids is not None:
        ids = list(dict.fromkeys(candidate_ids))
        query = query.where(LeadCandidate.id.in_(ids))
    else:
        ids = None
        query = query.where(LeadCandidate.selected.is_(True))
    candidates = list(db.scalars(query.order_by(LeadCandidate.score.desc(), LeadCandidate.email)))
    if ids is not None and len(candidates) != len(ids):
        raise HTTPException(422, "One or more candidates do not belong to this run")
    if not candidates:
        raise HTTPException(422, "Select at least one lead to save")
    if db.scalar(
        select(RecipientGroup.id).where(
            RecipientGroup.organization_id == org, RecipientGroup.name == group_name
        )
    ):
        raise HTTPException(409, "A recipient group with this name already exists")

    emails = [c.email.strip().lower() for c in candidates]
    suppressed = set(
        db.scalars(
            select(Suppression.email).where(
                Suppression.organization_id == org, Suppression.email.in_(emails)
            )
        )
    )
    existing = {
        r.email: r
        for r in db.scalars(
            select(Recipient).where(Recipient.organization_id == org, Recipient.email.in_(emails))
        )
    }
    created = reused = skipped = 0
    recipient_ids: list[str] = []
    for candidate, email in zip(candidates, emails):
        if email in suppressed:
            skipped += 1
            continue
        recipient = existing.get(email)
        if recipient is not None and not recipient.deleted:
            reused += 1
        else:
            fields = {
                "name": candidate.name or "",
                "company": candidate.company or "",
                "position": candidate.position or "",
                "custom_fields": {"lead_source_url": candidate.source_url or ""},
            }
            if recipient is None:
                recipient = Recipient(organization_id=org, email=email, **fields)
                db.add(recipient)
                existing[email] = recipient
            else:  # soft-deleted earlier: revive it, like POST /recipients does
                for key, value in fields.items():
                    setattr(recipient, key, value)
                recipient.deleted = False
            created += 1
        db.flush()
        if recipient.id not in recipient_ids:
            recipient_ids.append(recipient.id)
    if not recipient_ids:
        db.rollback()
        raise HTTPException(422, "All selected leads are on the suppression list")

    group = RecipientGroup(organization_id=org, name=group_name)
    db.add(group)
    db.flush()
    db.add_all(
        GroupMember(organization_id=org, group_id=group.id, recipient_id=rid)
        for rid in recipient_ids
    )
    audit(db, user, "recipient_group.created", group.id, {"members": len(recipient_ids)})
    audit(
        db,
        user,
        "lead_finder.group_saved",
        run.id,
        {
            "group_id": group.id,
            "created": created,
            "reused": reused,
            "skipped": skipped,
        },
    )
    db.commit()
    return {
        "group_id": group.id,
        "group_name": group.name,
        "created": created,
        "reused": reused,
        "skipped": skipped,
        "recipient_ids": recipient_ids,
        "recipient_count": len(recipient_ids),
    }
