"""Batch pipeline: search -> fetch -> extract -> upsert LeadCandidates for a run."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.lead_finder.brief import build_search_queries
from app.lead_finder.extract import extract_candidates_from_text, normalize_email
from app.lead_finder.fetch import fetch_page_text
from app.lead_finder.schemas import CandidateDraft, LeadBrief
from app.lead_finder.search import LeadSearchConfigError, SearchHit, search_web
from app.models.entities import LeadCandidate, LeadSearchRun, Recipient, Suppression

_FIELDS = ("name", "company", "position", "source_url", "source_title", "snippet")
_PAGE_SIZE = 10
_MAX_SEEN_URLS = 1000


class _Superseded(Exception):
    """The run was cancelled or re-enqueued under a newer batch generation."""


def run_lead_batch(
    db: Session, run_id: str, *, batch_limit: int, generation: int | None = None
) -> dict:
    """Run one batch for ``run_id``.

    ``batch_limit`` caps how many *new* candidates this batch may add; the effective cap is
    ``min(batch_limit, max(0, run.target_count - candidates_already_kept))``.

    Search state persists in ``run.progress`` so repeated calls go deeper instead of
    re-reading the first page: ``query_offset`` counts queries issued across batches (query
    ``offset % len(queries)``, result offset ``(offset // len(queries)) * 10``), ``seen_urls``
    lists pages already fetched (skipped next time), and ``queries_done`` / ``pages_fetched``
    accumulate. Any unexpected error marks the run ``failed`` (never left ``running``).

    ``generation`` must match ``run.progress["batch_generation"]``` when given; every enqueue
    bumps it, so a stale worker stops (without writing) once a newer batch is queued. A run
    that is cancelled mid-batch is never overwritten with another status.

    Returns ``{"kept", "suppressed", "queries_done", "pages_fetched", "status"}`` where
    ``kept`` is the run's total candidate count and the counters are cumulative.
    """
    run = db.get(LeadSearchRun, run_id)
    if run is None:
        raise ValueError(f"Lead search run {run_id} not found")
    prior = dict(run.progress or {})
    if run.status == "cancelled" or _stale_generation(prior, generation):
        return _summary(db, run, 0, 0, 0)

    progress: dict = {
        "batch_generation": prior.get("batch_generation"),
        "queries_done": int(prior.get("queries_done") or 0),
        "pages_fetched": int(prior.get("pages_fetched") or 0),
        "query_offset": int(prior.get("query_offset") or 0),
        "search_page": int(prior.get("search_page") or 0),
        "seen_urls": [str(u) for u in (prior.get("seen_urls") or [])][-_MAX_SEEN_URLS:],
        "candidates_kept": 0,
        "message": "Searching public pages",
        "warning": "",
    }
    suppressed_seen: set[str] = set()
    try:
        run.status = "running"
        run.error = None
        progress["candidates_kept"] = _count(db, run)
        run.progress = dict(progress)
        db.commit()
        return _run_batch(db, run, batch_limit, progress, suppressed_seen, generation)
    except _Superseded:
        db.rollback()
        run = db.get(LeadSearchRun, run_id)
        return _summary(db, run, progress["queries_done"], progress["pages_fetched"], 0)
    except LeadSearchConfigError as error:
        return _fail(db, run_id, progress, generation, str(error), "Lead search is not configured")
    except Exception as error:  # never leave the run stuck in "running"
        return _fail(
            db,
            run_id,
            progress,
            generation,
            f"{type(error).__name__}: {error}",
            "Lead search failed unexpectedly",
        )


def _stale_generation(progress: dict, generation: int | None) -> bool:
    return generation is not None and progress.get("batch_generation") != generation


def _ensure_current(db: Session, run: LeadSearchRun, generation: int | None) -> None:
    db.refresh(run)
    if run.status == "cancelled" or _stale_generation(run.progress or {}, generation):
        raise _Superseded()


def _run_batch(
    db: Session,
    run: LeadSearchRun,
    batch_limit: int,
    progress: dict,
    suppressed_seen: set[str],
    generation: int | None,
) -> dict:
    brief = LeadBrief.model_validate(run.brief or {})
    queries = build_search_queries(brief)
    errors: list[str] = []
    kept_start = progress["candidates_kept"]
    effective = min(max(0, batch_limit), max(0, run.target_count - kept_start))
    goal = kept_start + effective
    seen = set(progress["seen_urls"])
    batch_queries = 0

    for _ in range(len(queries)):
        if progress["candidates_kept"] >= goal:
            break
        _ensure_current(db, run, generation)
        offset = progress["query_offset"]
        query = queries[offset % len(queries)]
        page = offset // len(queries)
        progress["search_page"] = page
        progress["query_offset"] = offset + 1
        batch_queries += 1
        try:
            hits = search_web(query, num=_PAGE_SIZE, start=page * _PAGE_SIZE)
        except LeadSearchConfigError:
            raise
        except Exception as error:
            errors.append(f"{type(error).__name__}: {error}")
            progress["queries_done"] += 1
            _save(db, run, progress, errors, generation)
            continue
        for hit in hits:
            if progress["candidates_kept"] >= goal:
                break
            if hit.url in seen:
                continue
            page_text = _fetch(hit)
            if page_text is None:
                continue
            seen.add(hit.url)
            progress["seen_urls"] = [*progress["seen_urls"], hit.url][-_MAX_SEEN_URLS:]
            progress["pages_fetched"] += 1
            drafts = extract_candidates_from_text(
                f"{hit.snippet}\n{page_text}",
                source_url=hit.url,
                source_title=hit.title,
                snippet=hit.snippet,
            )
            for draft in drafts:
                allow_insert = progress["candidates_kept"] < goal
                inserted, suppressed = _upsert(db, run, draft, allow_insert=allow_insert)
                if suppressed:
                    suppressed_seen.add(normalize_email(draft.email))
                progress["candidates_kept"] += int(inserted)
            progress["candidates_kept"] = _count(db, run)
        progress["queries_done"] += 1
        _save(db, run, progress, errors, generation)

    _ensure_current(db, run, generation)
    if errors and batch_queries and len(errors) == batch_queries and not progress["candidates_kept"]:
        run.status = "failed"
        run.error = "All search queries failed: " + errors[0]
        progress["message"] = "Search provider errors"
    else:
        run.status = "ready"
        if progress["candidates_kept"]:
            progress["message"] = f"Found {progress['candidates_kept']} candidates"
        else:
            progress["message"] = "No candidates found. Try broadening location or role."
    _save(db, run, progress, errors, generation, check=False)
    return _summary(
        db, run, progress["queries_done"], progress["pages_fetched"], len(suppressed_seen)
    )


def _fail(
    db: Session, run_id: str, progress: dict, generation: int | None, error: str, message: str
) -> dict:
    db.rollback()
    run = db.get(LeadSearchRun, run_id)
    db.refresh(run)
    if run.status == "cancelled" or _stale_generation(run.progress or {}, generation):
        return _summary(db, run, progress["queries_done"], progress["pages_fetched"], 0)
    run.status = "failed"
    run.error = error
    progress["message"] = message
    run.progress = dict(progress)
    db.commit()
    return _summary(db, run, progress["queries_done"], progress["pages_fetched"], 0)


def _fetch(hit: SearchHit) -> str | None:
    try:
        return fetch_page_text(hit.url)
    except Exception:
        return None


def _count(db: Session, run: LeadSearchRun) -> int:
    return db.scalar(
        select(func.count()).select_from(LeadCandidate).where(LeadCandidate.run_id == run.id)
    ) or 0


def _save(
    db: Session,
    run: LeadSearchRun,
    progress: dict,
    errors: list[str],
    generation: int | None,
    *,
    check: bool = True,
) -> None:
    if check:
        db.flush()
        _ensure_current(db, run, generation)
    progress["warning"] = (
        f"{len(errors)} search request(s) failed; results may be partial. {errors[0]}"
        if errors
        else ""
    )
    run.progress = dict(progress)
    db.commit()


def _summary(db: Session, run: LeadSearchRun, queries: int, pages: int, suppressed: int) -> dict:
    return {
        "kept": _count(db, run),
        "suppressed": suppressed,
        "queries_done": queries,
        "pages_fetched": pages,
        "status": run.status,
    }


def _upsert(
    db: Session, run: LeadSearchRun, draft: CandidateDraft, *, allow_insert: bool = True
) -> tuple[bool, bool]:
    """Insert or improve a candidate. Returns ``(inserted, suppressed)``.

    New emails are only inserted while ``allow_insert`` (the batch goal is not yet met).
    ``selected`` is only set on insert; updates preserve it (user may have patched it) unless
    the email is suppressed, which forces it to False. Fields listed in
    ``signals["user_edited"]`` (set by PATCH) are never overwritten by a re-sighting.
    """
    email = normalize_email(draft.email)
    existing = db.scalar(
        select(LeadCandidate).where(LeadCandidate.run_id == run.id, LeadCandidate.email == email)
    )
    if existing is None and not allow_insert:
        return False, False
    suppressed = (
        db.scalar(
            select(Suppression.id).where(
                Suppression.organization_id == run.organization_id, Suppression.email == email
            )
        )
        is not None
    )
    recipient_id = db.scalar(
        select(Recipient.id).where(
            Recipient.organization_id == run.organization_id,
            Recipient.email == email,
            Recipient.deleted.is_(False),
        )
    )
    signals = dict(draft.signals)
    if suppressed:
        signals["suppressed"] = True
    selected = False if suppressed else draft.selected
    if existing is None:
        db.add(
            LeadCandidate(
                organization_id=run.organization_id,
                run_id=run.id,
                email=email,
                score=draft.score,
                signals=signals,
                selected=selected,
                existing_recipient_id=recipient_id,
                **{field: getattr(draft, field) for field in _FIELDS},
            )
        )
        db.flush()
        return True, suppressed
    user_edited = list((existing.signals or {}).get("user_edited") or [])
    if draft.score > existing.score:
        for field in _FIELDS:
            if field not in user_edited:
                setattr(existing, field, getattr(draft, field))
        existing.score = draft.score
        existing.signals = {**signals, "user_edited": user_edited} if user_edited else signals
    if suppressed:
        existing.selected = False
        existing.signals = {**(existing.signals or {}), "suppressed": True}
    existing.existing_recipient_id = recipient_id
    db.flush()
    return False, suppressed
