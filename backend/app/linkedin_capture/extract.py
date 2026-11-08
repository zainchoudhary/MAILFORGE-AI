from __future__ import annotations

from app.lead_finder.extract import (
    _EMAIL_RE,
    _WINDOW_AFTER,
    _WINDOW_BEFORE,
    _accept_email,
    _company_from_domain,
    _compact,
    extract_candidates_from_text,
    is_hard_rejected_email,
)
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
    # snippet="" so each draft keeps the text around its own email, not the job header.
    drafts = extract_candidates_from_text(
        text, source_url=job_url or "", source_title=title or "", snippet=""
    )
    out: list[CandidateDraft] = []
    for d in drafts:
        signals = dict(d.signals or {})
        signals["source"] = "linkedin_job_post"
        company_val = d.company or company or ""
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
    out.extend(_dropped_email_fallback(text, {d.email for d in out}, title, company, job_url))
    return out


def _dropped_email_fallback(
    text: str, seen: set[str], title: str, company: str, job_url: str
) -> list[CandidateDraft]:
    """Keep emails Lead Finder drops for lacking a nearby name/company (e.g. gmail.com).

    A job post already tells us the company, so an email in the post is a usable lead even when
    no person name is next to it. Never auto-selected: the user reviews these in Studio.
    """
    out: list[CandidateDraft] = []
    seen = set(seen)
    for match in _EMAIL_RE.finditer(text):
        email = _accept_email(match.group(0))
        if not email or email in seen or is_hard_rejected_email(email):
            continue
        company_val = (company or "").strip() or _company_from_domain(email)
        if not company_val:
            continue
        seen.add(email)
        window = text[max(0, match.start() - _WINDOW_BEFORE) : match.end() + _WINDOW_AFTER]
        out.append(
            CandidateDraft(
                email=email,
                name="",
                company=company_val,
                position=title or "",
                source_url=job_url or "",
                source_title=title or "",
                snippet=_compact(window),
                score=0.0,
                signals={"source": "linkedin_job_post", "company_fallback": True},
                selected=False,
            )
        )
    return out
