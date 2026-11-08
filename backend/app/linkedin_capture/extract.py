from __future__ import annotations

import re

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

_SEARCH_URL_RE = re.compile(r"/search/results/|/jobs/search|/jobs/collections", re.I)
_ACTIVITY_ID_RE = re.compile(r"(?:activity|ugcPost|share)[:\-](\d{6,})", re.I)
_POST_PERMALINK_RE = re.compile(
    r"/feed/update/urn:li:(?:activity|ugcPost|share):\d+|/posts/[^/?#]+", re.I
)


def is_post_permalink(url: str) -> bool:
    if not url or _SEARCH_URL_RE.search(url):
        return False
    return bool(_POST_PERMALINK_RE.search(url))


def permalink_from_activity_id(activity_id: str, kind: str = "activity") -> str:
    if not activity_id:
        return ""
    kind = kind if kind in ("activity", "ugcPost", "share") else "activity"
    return f"https://www.linkedin.com/feed/update/urn:li:{kind}:{activity_id}/"


def canonicalize_post_url(
    *,
    job_url: str = "",
    linkedin_job_id: str = "",
    list_payload: dict | None = None,
    detail_payload: dict | None = None,
) -> str:
    """Prefer a real post permalink; never keep LinkedIn search-result URLs as source_url."""
    detail = detail_payload or {}
    list_p = list_payload or {}
    for candidate in (
        detail.get("post_url"),
        job_url,
        list_p.get("post_url"),
    ):
        url = (candidate or "").strip()
        if is_post_permalink(url):
            return url.split("?")[0]

    urn = (list_p.get("urn") or detail.get("urn") or "").strip()
    m = _ACTIVITY_ID_RE.search(urn) or _ACTIVITY_ID_RE.search(linkedin_job_id or "")
    if m:
        kind = "ugcPost" if "ugcPost" in (urn or linkedin_job_id) else "activity"
        return permalink_from_activity_id(m.group(1), kind)

    # linkedin_job_id shape from extension: p{activityId}
    if linkedin_job_id and re.fullmatch(r"p\d{6,}", linkedin_job_id):
        return permalink_from_activity_id(linkedin_job_id[1:], "activity")

    url = (job_url or "").strip()
    if url and not _SEARCH_URL_RE.search(url):
        return url.split("?")[0]
    return ""


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
    linkedin_job_id: str = "",
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
    detail = detail_payload or {}
    list_p = list_payload or {}
    kind = (detail.get("kind") or list_p.get("kind") or "job").strip().lower()
    source_signal = "linkedin_post" if kind in ("post", "search_email") else "linkedin_job_post"
    source_url = canonicalize_post_url(
        job_url=job_url or "",
        linkedin_job_id=linkedin_job_id or "",
        list_payload=list_p,
        detail_payload=detail,
    )
    # Prefer author/title for name when this is a feed post.
    author = (detail.get("author") or list_p.get("author") or "").strip()
    # snippet="" so each draft keeps the text around its own email, not the header.
    drafts = extract_candidates_from_text(
        text, source_url=source_url or "", source_title=title or "", snippet=""
    )
    out: list[CandidateDraft] = []
    for d in drafts:
        signals = dict(d.signals or {})
        signals["source"] = source_signal
        company_val = d.company or company or ""
        name_val = d.name or author or ""
        position_val = d.position or ("" if kind in ("post", "search_email") else (title or ""))
        if kind in ("post", "search_email") and not position_val:
            position_val = (detail.get("subtitle") or list_p.get("subtitle") or "")[:200]
        out.append(
            CandidateDraft(
                email=d.email,
                name=name_val,
                company=company_val,
                position=position_val,
                source_url=source_url or "",
                source_title=title or d.source_title,
                snippet=d.snippet,
                score=d.score,
                signals=signals,
                selected=d.selected if (name_val or company_val) else False,
            )
        )
    out.extend(
        _dropped_email_fallback(
            text, {d.email for d in out}, title, company, source_url, source_signal=source_signal
        )
    )
    return out


def _dropped_email_fallback(
    text: str,
    seen: set[str],
    title: str,
    company: str,
    job_url: str,
    *,
    source_signal: str = "linkedin_job_post",
) -> list[CandidateDraft]:
    """Keep emails Lead Finder drops for lacking a nearby name/company (e.g. gmail.com).

    Job/post context already gives company (or domain stem), so the address is still usable.
    Never auto-selected: the user reviews these in Studio.
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
                signals={"source": source_signal, "company_fallback": True},
                selected=False,
            )
        )
    return out
