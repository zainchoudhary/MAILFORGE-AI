"""LinkedIn capture service: run lifecycle, batch job upsert, offline extraction, save as group.

Extraction only ever uses text the browser extension already captured (``extract_from_job``);
this module never calls Serper/CSE or fetches pages.
"""

import logging

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.lead_finder.extract import normalize_email
from app.linkedin_capture.extract import extract_from_job
from app.linkedin_capture.schemas import DETAIL_STATUSES
from app.models.entities import (
    GroupMember,
    LinkedInCaptureRun,
    LinkedInJobRaw,
    LinkedInLeadCandidate,
    Recipient,
    RecipientGroup,
    Suppression,
)
from app.repositories.common import audit, owned, page, serialize

logger = logging.getLogger(__name__)

_CAND_FIELDS = ("name", "company", "position", "source_url", "source_title", "snippet")
_CAND_LIMITS = {"name": 200, "company": 200, "position": 200, "source_title": 500}


def _clip(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


# --------------------------------------------------------------------------- reads


def job_count(db: Session, run_id: str) -> int:
    return db.scalar(
        select(func.count()).select_from(LinkedInJobRaw).where(LinkedInJobRaw.run_id == run_id)
    ) or 0


def candidate_count(db: Session, run_id: str) -> int:
    return db.scalar(
        select(func.count())
        .select_from(LinkedInLeadCandidate)
        .where(LinkedInLeadCandidate.run_id == run_id)
    ) or 0


def run_payload(db: Session, run: LinkedInCaptureRun) -> dict:
    return {
        **serialize(run),
        "job_count": job_count(db, run.id),
        "candidate_count": candidate_count(db, run.id),
    }


def list_runs(db: Session, user, limit: int = 50) -> dict:
    runs = list(
        db.scalars(
            select(LinkedInCaptureRun)
            .where(LinkedInCaptureRun.organization_id == user.organization_id)
            .order_by(LinkedInCaptureRun.created_at.desc())
            .limit(limit)
        )
    )
    ids = [r.id for r in runs]
    jobs = dict(
        db.execute(
            select(LinkedInJobRaw.run_id, func.count())
            .where(LinkedInJobRaw.run_id.in_(ids))
            .group_by(LinkedInJobRaw.run_id)
        ).all()
    )
    cands = dict(
        db.execute(
            select(LinkedInLeadCandidate.run_id, func.count())
            .where(LinkedInLeadCandidate.run_id.in_(ids))
            .group_by(LinkedInLeadCandidate.run_id)
        ).all()
    )
    return {
        "items": [
            {
                **serialize(r),
                "job_count": jobs.get(r.id, 0),
                "candidate_count": cands.get(r.id, 0),
            }
            for r in runs
        ]
    }


def get_run(db: Session, user, run_id: str) -> dict:
    return run_payload(db, owned(db, LinkedInCaptureRun, run_id, user.organization_id))


def list_jobs(
    db: Session,
    user,
    run_id: str,
    page_number: int = 1,
    limit: int = 100,
    detail_status: str | None = None,
) -> dict:
    owned(db, LinkedInCaptureRun, run_id, user.organization_id)
    conditions = [LinkedInJobRaw.run_id == run_id]
    if detail_status:
        if detail_status not in DETAIL_STATUSES:
            raise HTTPException(422, f"detail_status must be one of {', '.join(DETAIL_STATUSES)}")
        conditions.append(LinkedInJobRaw.detail_status == detail_status)
    return page(
        db,
        LinkedInJobRaw,
        user.organization_id,
        page_number,
        limit,
        conditions,
        order=(LinkedInJobRaw.created_at, LinkedInJobRaw.linkedin_job_id),
    )


def list_candidates(
    db: Session, user, run_id: str, page_number: int = 1, limit: int = 100
) -> dict:
    owned(db, LinkedInCaptureRun, run_id, user.organization_id)
    result = page(
        db,
        LinkedInLeadCandidate,
        user.organization_id,
        page_number,
        limit,
        [LinkedInLeadCandidate.run_id == run_id],
        order=(LinkedInLeadCandidate.score.desc(), LinkedInLeadCandidate.email),
    )
    _enrich_candidate_post_urls(db, result.get("items") or [])
    return result


def _enrich_candidate_post_urls(db: Session, items: list[dict]) -> None:
    """Fill missing source_url from the linked job so View post can open the real permalink."""
    from app.linkedin_capture.extract import canonicalize_post_url

    need_ids = [
        item["job_raw_id"]
        for item in items
        if item.get("job_raw_id")
        and not (item.get("source_url") or "").strip()
        and not ((item.get("signals") or {}).get("post_url") or "").strip()
    ]
    if not need_ids:
        return
    jobs = {
        job.id: job
        for job in db.scalars(select(LinkedInJobRaw).where(LinkedInJobRaw.id.in_(need_ids)))
    }
    for item in items:
        if (item.get("source_url") or "").strip() or ((item.get("signals") or {}).get("post_url") or "").strip():
            if not (item.get("source_url") or "").strip():
                item["source_url"] = (item.get("signals") or {}).get("post_url") or ""
            continue
        job = jobs.get(item.get("job_raw_id"))
        if not job:
            continue
        url = canonicalize_post_url(
            job_url=job.job_url or "",
            linkedin_job_id=job.linkedin_job_id or "",
            list_payload=job.list_payload if isinstance(job.list_payload, dict) else {},
            detail_payload=job.detail_payload if isinstance(job.detail_payload, dict) else {},
        )
        if not url:
            continue
        item["source_url"] = url
        signals = dict(item.get("signals") or {})
        signals["post_url"] = url
        item["signals"] = signals


# ----------------------------------------------------------------------- lifecycle


def create_run(
    db: Session, user, *, search_url: str = "", search_query_snapshot: str = ""
) -> LinkedInCaptureRun:
    run = LinkedInCaptureRun(
        organization_id=user.organization_id,
        created_by_user_id=user.id,
        search_url=search_url or "",
        search_query_snapshot=search_query_snapshot or "",
        status="idle",
        progress={"listed": 0, "message": "Waiting for jobs from the extension"},
    )
    db.add(run)
    db.flush()
    audit(db, user, "linkedin_capture.run_created", run.id)
    db.commit()
    db.refresh(run)
    return run


def cancel_run(db: Session, user, run_id: str) -> LinkedInCaptureRun:
    run = owned(db, LinkedInCaptureRun, run_id, user.organization_id)
    if run.status not in ("idle", "extracting", "ready"):
        raise HTTPException(409, f"A {run.status} run cannot be cancelled")
    run.status = "cancelled"
    run.progress = {**(run.progress or {}), "message": "Cancelled; captured data kept"}
    audit(db, user, "linkedin_capture.run_cancelled", run.id)
    db.commit()
    return run


def delete_runs(db: Session, user, run_ids: list[str]) -> dict:
    """Hard-delete capture runs and their jobs/candidates from the DB."""
    ids = list(dict.fromkeys([str(rid).strip() for rid in (run_ids or []) if str(rid).strip()]))
    if not ids:
        raise HTTPException(422, "Select at least one capture to delete")
    if len(ids) > 100:
        raise HTTPException(422, "You can delete at most 100 captures at once")

    runs = list(
        db.scalars(
            select(LinkedInCaptureRun).where(
                LinkedInCaptureRun.organization_id == user.organization_id,
                LinkedInCaptureRun.id.in_(ids),
            )
        )
    )
    found = {r.id for r in runs}
    missing = [rid for rid in ids if rid not in found]
    if missing:
        raise HTTPException(404, f"Capture not found: {missing[0]}")

    # Candidates reference job_raw; delete children first (no ON DELETE CASCADE).
    db.execute(
        delete(LinkedInLeadCandidate).where(
            LinkedInLeadCandidate.organization_id == user.organization_id,
            LinkedInLeadCandidate.run_id.in_(ids),
        )
    )
    db.execute(
        delete(LinkedInJobRaw).where(
            LinkedInJobRaw.organization_id == user.organization_id,
            LinkedInJobRaw.run_id.in_(ids),
        )
    )
    db.execute(
        delete(LinkedInCaptureRun).where(
            LinkedInCaptureRun.organization_id == user.organization_id,
            LinkedInCaptureRun.id.in_(ids),
        )
    )
    for run_id in ids:
        audit(db, user, "linkedin_capture.run_deleted", run_id)
    db.commit()
    return {"deleted": len(ids), "run_ids": ids}


# -------------------------------------------------------------------- batch upsert


def upsert_jobs_batch(
    db: Session, user, run_id: str, jobs: list[dict], *, extract: bool = True
) -> dict:
    run = owned(db, LinkedInCaptureRun, run_id, user.organization_id)
    if run.status == "cancelled":
        raise HTTPException(409, "A cancelled run cannot accept more jobs")
    settings = get_settings()
    ceiling = max(1, settings.linkedin_capture_hard_ceiling)
    soft_max = max(1, settings.linkedin_capture_max_jobs_per_run)

    # Normalise and de-duplicate the incoming batch by linkedin_job_id (later entries merge in).
    incoming: dict[str, dict] = {}
    for raw in jobs or []:
        jid = _clip(raw.get("linkedin_job_id"), 64)
        if not jid:
            continue
        if jid in incoming:
            prev = incoming[jid]
            merged = {**prev, **{k: v for k, v in raw.items() if v not in (None, "", {})}}
            merged["list_payload"] = {
                **(prev.get("list_payload") or {}),
                **(raw.get("list_payload") or {}),
            }
            incoming[jid] = merged
        else:
            incoming[jid] = dict(raw)

    existing: dict[str, LinkedInJobRaw] = {}
    if incoming:
        existing = {
            j.linkedin_job_id: j
            for j in db.scalars(
                select(LinkedInJobRaw).where(
                    LinkedInJobRaw.run_id == run.id,
                    LinkedInJobRaw.linkedin_job_id.in_(list(incoming)),
                )
            )
        }
    new_ids = [jid for jid in incoming if jid not in existing]
    total_before = job_count(db, run.id)
    if total_before + len(new_ids) > ceiling:
        raise HTTPException(
            422,
            f"Run would exceed the hard ceiling of {ceiling} jobs "
            f"({total_before} already captured, {len(new_ids)} new)",
        )

    inserted = updated = 0
    touched_ids: list[str] = []
    for jid, raw in incoming.items():
        job = existing.get(jid)
        is_new = job is None
        if is_new:
            job = LinkedInJobRaw(
                organization_id=run.organization_id,
                run_id=run.id,
                linkedin_job_id=jid,
                list_payload={},
                detail_status="pending",
            )
            db.add(job)
        for field, limit in (("title", 500), ("company", 300), ("location", 300)):
            val = _clip(raw.get(field), limit)
            if val:
                setattr(job, field, val)
        if raw.get("job_url"):
            from app.linkedin_capture.extract import canonicalize_post_url

            cleaned = canonicalize_post_url(
                job_url=str(raw["job_url"]).strip(),
                linkedin_job_id=jid,
                list_payload=raw.get("list_payload") if isinstance(raw.get("list_payload"), dict) else {},
                detail_payload=raw.get("detail_payload") if isinstance(raw.get("detail_payload"), dict) else {},
            )
            if cleaned:
                job.job_url = cleaned
        lp = raw.get("list_payload")
        if isinstance(lp, dict) and lp:
            job.list_payload = {**(job.list_payload or {}), **lp}
        dp = raw.get("detail_payload")
        status = raw.get("detail_status")
        if dp:
            job.detail_payload = dp
            job.detail_status = "fetched"
        elif status in DETAIL_STATUSES and not (
            job.detail_status == "fetched" and job.detail_payload
        ):
            job.detail_status = status
        db.flush()
        touched_ids.append(job.id)
        if is_new:
            inserted += 1
        else:
            updated += 1

    listed = total_before + inserted
    progress = {**(run.progress or {}), "listed": listed, "message": "Synced"}
    if listed > soft_max:
        progress["warning"] = f"{listed} jobs captured; recommended maximum is {soft_max}"
    else:
        progress.pop("warning", None)
    run.status = "idle"
    run.error = None
    if progress.get("details_requested") and not db.scalar(
        select(LinkedInJobRaw.id)
        .where(LinkedInJobRaw.run_id == run.id, LinkedInJobRaw.detail_status == "pending")
        .limit(1)
    ):
        progress.pop("details_requested", None)  # Studio's request is fully served
    run.progress = progress
    audit(
        db,
        user,
        "linkedin_capture.jobs_upserted",
        run.id,
        {"inserted": inserted, "updated": updated},
    )
    db.commit()

    extract_stats: dict = {}
    if extract and touched_ids:
        extract_stats = extract_run(db, user, run_id, job_raw_ids=touched_ids)
    return {"inserted": inserted, "updated": updated, "extract": extract_stats}


def request_fetch_details(
    db: Session, user, run_id: str, job_ids: list[str] | None
) -> dict:
    """Mark jobs as needing detail scrape and return them for the extension.

    ``job_ids`` may hold LinkedInJobRaw ids or LinkedIn job ids. ``None`` selects every job
    still ``pending``/``failed``. Selected jobs are (re)set to ``pending`` and the run gets
    ``progress.details_requested`` so the extension's background poll knows Studio asked for
    them (plain freshly-captured pending jobs are NOT scraped automatically). The flag clears
    once no pending jobs remain (see ``upsert_jobs_batch``).
    """
    run = owned(db, LinkedInCaptureRun, run_id, user.organization_id)
    query = select(LinkedInJobRaw).where(
        LinkedInJobRaw.run_id == run.id, LinkedInJobRaw.organization_id == run.organization_id
    )
    if job_ids is None:
        query = query.where(LinkedInJobRaw.detail_status.in_(("pending", "failed")))
        jobs = list(db.scalars(query.order_by(LinkedInJobRaw.created_at)))
        for job in jobs:
            job.detail_status = "pending"  # retry failed ones too
    else:
        ids = list(dict.fromkeys(job_ids))
        query = query.where(
            or_(LinkedInJobRaw.id.in_(ids), LinkedInJobRaw.linkedin_job_id.in_(ids))
        )
        jobs = list(db.scalars(query.order_by(LinkedInJobRaw.created_at)))
        matched = {j.id for j in jobs} | {j.linkedin_job_id for j in jobs}
        if any(i not in matched for i in ids):
            raise HTTPException(422, "One or more jobs do not belong to this run")
        for job in jobs:
            job.detail_status = "pending"
    if jobs:
        run.progress = {
            **(run.progress or {}),
            "message": f"Waiting for details on {len(jobs)} job(s)",
            "details_requested": True,
        }
        audit(db, user, "linkedin_capture.details_requested", run.id, {"count": len(jobs)})
    db.commit()
    return {
        "job_ids": [j.id for j in jobs],
        "linkedin_job_ids": [j.linkedin_job_id for j in jobs],
        "jobs": [
            {"id": j.id, "linkedin_job_id": j.linkedin_job_id, "job_url": j.job_url}
            for j in jobs
        ],
    }


# ----------------------------------------------------------------------- extraction


def extract_run(
    db: Session, user, run_id: str, job_raw_ids: list[str] | None = None
) -> dict:
    """Extract candidates from captured job text. Idempotent (upsert by run + email)."""
    run = owned(db, LinkedInCaptureRun, run_id, user.organization_id)
    if run.status == "cancelled":
        raise HTTPException(409, "A cancelled run cannot be extracted")
    org = run.organization_id
    query = select(LinkedInJobRaw).where(
        LinkedInJobRaw.run_id == run.id, LinkedInJobRaw.organization_id == org
    )
    if job_raw_ids is not None:
        query = query.where(LinkedInJobRaw.id.in_(list(dict.fromkeys(job_raw_ids))))
    jobs = list(db.scalars(query.order_by(LinkedInJobRaw.created_at)))

    run.status = "extracting"
    run.progress = {**(run.progress or {}), "message": "Extracting emails"}
    db.commit()

    stats = {
        "jobs": len(jobs),
        "inserted": 0,
        "updated": 0,
        "skipped_recipient": 0,
        "skipped_suppressed": 0,
    }
    try:
        for job in jobs:
            drafts = extract_from_job(
                title=job.title,
                company=job.company,
                location=job.location,
                job_url=job.job_url,
                list_payload=job.list_payload,
                detail_payload=job.detail_payload,
                linkedin_job_id=job.linkedin_job_id or "",
            )
            for draft in drafts:
                outcome = _upsert_candidate(db, run, job, draft)
                stats[outcome] += 1
        db.flush()
        total = candidate_count(db, run.id)
        stats["candidates"] = total
        run.status = "ready"
        run.error = None
        run.progress = {
            **(run.progress or {}),
            "candidates_kept": total,
            "message": f"Extracted {total} candidate(s)",
        }
        audit(db, user, "linkedin_capture.extracted", run.id, dict(stats))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("LinkedIn capture extraction failed", exc_info=True)
        run = db.get(LinkedInCaptureRun, run_id)
        if run is not None:
            run.status = "failed"
            run.error = str(exc)[:500]
            run.progress = {**(run.progress or {}), "message": "Extraction failed"}
            db.commit()
        raise
    return stats


def _upsert_candidate(db: Session, run: LinkedInCaptureRun, job: LinkedInJobRaw, draft) -> str:
    """Insert/improve one candidate. Returns the stats key it counts toward."""
    org = run.organization_id
    email = normalize_email(draft.email)
    if db.scalar(
        select(Recipient.id).where(
            Recipient.organization_id == org,
            Recipient.email == email,
            Recipient.deleted.is_(False),
        )
    ):
        return "skipped_recipient"
    if db.scalar(
        select(Suppression.id).where(Suppression.organization_id == org, Suppression.email == email)
    ):
        return "skipped_suppressed"
    values = {
        f: (_clip(getattr(draft, f), _CAND_LIMITS[f]) if f in _CAND_LIMITS else getattr(draft, f))
        for f in _CAND_FIELDS
    }
    existing = db.scalar(
        select(LinkedInLeadCandidate).where(
            LinkedInLeadCandidate.run_id == run.id, LinkedInLeadCandidate.email == email
        )
    )
    signals = dict(draft.signals or {})
    if existing is None:
        db.add(
            LinkedInLeadCandidate(
                organization_id=org,
                run_id=run.id,
                job_raw_id=job.id,
                email=email,
                score=draft.score,
                signals=signals,
                selected=draft.selected,
                existing_recipient_id=None,
                **values,
            )
        )
        db.flush()
        return "inserted"
    user_edited = list((existing.signals or {}).get("user_edited") or [])
    richer_body = len(str((signals or {}).get("post_body") or "")) > len(
        str((existing.signals or {}).get("post_body") or "")
    )
    richer_identity = (
        (not (existing.name or "").strip() and bool(str(values.get("name") or "").strip()))
        or (not (existing.position or "").strip() and bool(str(values.get("position") or "").strip()))
    )
    if draft.score > existing.score or richer_body or richer_identity:
        for field, value in values.items():
            if field in user_edited:
                continue
            if draft.score > existing.score:
                setattr(existing, field, value)
            elif value not in (None, "") and not (getattr(existing, field) or ""):
                setattr(existing, field, value)
        if draft.score > existing.score:
            existing.score = draft.score
        existing.job_raw_id = job.id
        merged_signals = {**(existing.signals or {}), **signals}
        if user_edited:
            merged_signals["user_edited"] = user_edited
        existing.signals = merged_signals
    # Fill missing permalinks, and upgrade weak feed/update URNs to /posts/ slugs.
    new_url = (values.get("source_url") or "").strip()
    old_url = (existing.source_url or "").strip()
    better_url = bool(new_url) and (
        not old_url
        or ("/posts/" in new_url.lower() and "/posts/" not in old_url.lower())
    )
    if better_url:
        existing.source_url = new_url
        existing.job_raw_id = job.id
        merged = {**(existing.signals or {}), **signals}
        merged["post_url"] = new_url
        if user_edited:
            merged["user_edited"] = user_edited
        existing.signals = merged
    db.flush()
    return "updated"


# ----------------------------------------------------------------------- candidates


def patch_candidate(db: Session, user, run_id: str, candidate_id: str, changes: dict) -> dict:
    """Apply a partial update (keys: email, name, company, position, selected)."""
    org = user.organization_id
    owned(db, LinkedInCaptureRun, run_id, org)
    candidate = owned(db, LinkedInLeadCandidate, candidate_id, org)
    if candidate.run_id != run_id:
        raise HTTPException(404, "Record not found")
    changes = {
        k: v for k, v in changes.items() if k in ("email", "name", "company", "position", "selected")
    }
    if changes.get("email") is None:
        changes.pop("email", None)
    if "selected" in changes and changes["selected"] is None:
        changes.pop("selected")
    for field in ("name", "company", "position"):
        if field in changes:
            changes[field] = (changes[field] or "").strip()
    if "email" in changes:
        email = normalize_email(changes["email"] or "")
        if not email or "@" not in email:
            raise HTTPException(422, "Enter a valid email address")
        changes["email"] = email
        if email != candidate.email:
            if db.scalar(
                select(LinkedInLeadCandidate.id).where(
                    LinkedInLeadCandidate.run_id == run_id, LinkedInLeadCandidate.email == email
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
        f
        for f in ("name", "company", "position")
        if f in changes and changes[f] != (getattr(candidate, f) or "")
    }
    if edited:
        signals = dict(candidate.signals or {})
        signals["user_edited"] = sorted(edited | set(signals.get("user_edited") or []))
        candidate.signals = signals
    for key, value in changes.items():
        setattr(candidate, key, value)
    if suppressed:
        candidate.selected = False
    audit(db, user, "linkedin_capture.candidate_updated", candidate.id, {"fields": sorted(changes)})
    db.commit()
    return serialize(candidate)


def save_group(
    db: Session, user, run_id: str, group_name: str, candidate_ids: list[str] | None
) -> dict:
    org = user.organization_id
    run = owned(db, LinkedInCaptureRun, run_id, org)
    group_name = (group_name or "").strip()
    if not group_name:
        raise HTTPException(422, "Group name is required")
    cand = LinkedInLeadCandidate
    query = select(cand).where(cand.run_id == run.id, cand.organization_id == org)
    if candidate_ids is not None:
        ids = list(dict.fromkeys(candidate_ids))
        query = query.where(cand.id.in_(ids))
    else:
        ids = None
        query = query.where(cand.selected.is_(True))
    candidates = list(db.scalars(query.order_by(cand.score.desc(), cand.email)))
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
        "linkedin_capture.group_saved",
        run.id,
        {"group_id": group.id, "created": created, "reused": reused, "skipped": skipped},
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
