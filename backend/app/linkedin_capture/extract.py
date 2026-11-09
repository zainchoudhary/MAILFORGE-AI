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
_FEED_POST_HEADER_RE = re.compile(
    r"Feed post\s+(.+?)\s+•\s+(\d+(?:st|nd|rd|th))\s+(.+?)\s+"
    r"(\d+\s*(?:mo|yr|y|[smhdw])|just now|yesterday)\b",
    re.I,
)
_AUTHOR_JUNK_RE = re.compile(
    r"^(live demos|working hours|follow|connect|promoted|view|like|comment|repost|send|"
    r"us|uk|remote|full[-\s]?time|part[-\s]?time|data engineer|recruiter|hiring)$",
    re.I,
)
_VIEW_PROFILE_RE = re.compile(r"^View\s+(.+?)(?:['’]s)?\s+profile$", re.I)


def _clean_author(name: str) -> str:
    n = re.sub(r"\s+", " ", (name or "")).strip()
    if not n:
        return ""
    viewed = _VIEW_PROFILE_RE.match(n)
    if viewed:
        n = re.sub(r"\s+", " ", viewed.group(1)).strip()
    if _AUTHOR_JUNK_RE.match(n):
        return ""
    if len(n) < 2 or len(n) > 80 or "@" in n or n.lower().startswith("http"):
        return ""
    return n


def _is_junk_author(name: str) -> bool:
    return not _clean_author(name)


def _parse_feed_post_header(text: str) -> dict[str, str] | None:
    raw = re.sub(r"\s+", " ", (text or "")).strip()
    if not raw:
        return None
    m = _FEED_POST_HEADER_RE.search(raw)
    if not m:
        return None
    author = _clean_author(m.group(1))
    subtitle = re.sub(r"\s+", " ", m.group(3)).strip()
    subtitle = re.sub(r"\s+(Follow|Connect|Edited|•).*$", "", subtitle, flags=re.I).strip()
    if len(subtitle) > 200:
        subtitle = subtitle[:200]
    posted_at_text = re.sub(r"\s+", " ", m.group(4)).strip()
    if not (author or subtitle or posted_at_text):
        return None
    return {"author": author, "subtitle": subtitle, "posted_at_text": posted_at_text}


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
    subtitle = (detail.get("subtitle") or list_p.get("subtitle") or "").strip()
    posted_at = (detail.get("posted_at") or list_p.get("posted_at") or "").strip()
    posted_at_text = (detail.get("posted_at_text") or list_p.get("posted_at_text") or "").strip()
    # Prefer structured post description only — avoid concatenating title/company noise into View post.
    post_body = (detail.get("description") or list_p.get("description") or "").strip()
    if len(post_body) > 20000:
        post_body = post_body[:20000]
    # Content-search cards often leave author empty but embed:
    # "Feed post Muhammad Zubair • 2nd {Headline} 2h …"
    if kind in ("post", "search_email"):
        header = _parse_feed_post_header(post_body)
        if header:
            if header.get("author") and (not author or _is_junk_author(author)):
                author = header["author"]
            if header.get("subtitle") and (not subtitle or len(subtitle) < 8):
                subtitle = header["subtitle"]
            if header.get("posted_at_text") and not posted_at_text:
                posted_at_text = header["posted_at_text"]
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
    if kind in ("post", "search_email"):
        enriched: list[CandidateDraft] = []
        for d in out:
            signals = dict(d.signals or {})
            if posted_at:
                signals["posted_at"] = posted_at[:64]
            if posted_at_text:
                signals["posted_at_text"] = posted_at_text[:80]
            if post_body:
                signals["post_body"] = post_body
            enriched.append(
                CandidateDraft(
                    email=d.email,
                    # Spec: poster name first; near-email name only as fallback.
                    name=(author or d.name or "")[:200],
                    company=d.company or company or "",
                    # Subtitle is the poster's designation. The text extractor often
                    # keeps only a short role fragment ("Hiring Manager").
                    position=(subtitle or d.position or "")[:200],
                    source_url=d.source_url,
                    source_title=d.source_title or title or author,
                    snippet=d.snippet,
                    score=d.score,
                    signals=signals,
                    selected=d.selected if (author or d.name or d.company or company) else False,
                )
            )
        out = enriched
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
