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
# "• 2nd … 8h" block; author is trailing name tokens before the bullet.
_FEED_POST_BULLET_RE = re.compile(
    r"\s+•\s+(\d+(?:st|nd|rd|th)\+?)\s+(.+?)\s+"
    r"(\d+\s*(?:mo|yr|y|[smhdw])|just now|yesterday)\b",
    re.I,
)
_NAME_STOP = {
    "before",
    "after",
    "the",
    "and",
    "with",
    "from",
    "for",
    "noise",
    "hiring",
    "follow",
    "connect",
    "at",
    "ceo",
    "founder",
    "manager",
}
_COMPANY_FROM_SUBTITLE_RE = re.compile(
    r"(?:\bat\s+([^|•·@]{2,80})|@\s*([^|•·]{2,80}))\s*$",
    re.I,
)
_AUTHOR_JUNK_RE = re.compile(
    r"^(live demos|working hours|lahore location|google sheets|hiring alert|location|"
    r"follow|connect|promoted|view|like|comment|repost|send|"
    r"us|uk|uae|remote|full[-\s]?time|part[-\s]?time|data engineer|recruiter|hiring)$",
    re.I,
)
_AUTHOR_JUNK_SUFFIX_RE = re.compile(r"(hours|location|sheets|alert)$", re.I)
_COMPANY_JUNK_RE = re.compile(
    r"^(us|uk|uae|remote|google sheets|linkedin|excel|whatsapp|lahore|faisalabad)$",
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
    if _AUTHOR_JUNK_RE.match(n) or _AUTHOR_JUNK_SUFFIX_RE.search(n):
        return ""
    if len(n) < 2 or len(n) > 80 or "@" in n or n.lower().startswith("http"):
        return ""
    return n


def _is_junk_author(name: str) -> bool:
    return not _clean_author(name)


def _clean_company(value: str) -> str:
    n = re.sub(r"\s+", " ", (value or "")).strip()
    if not n or _COMPANY_JUNK_RE.match(n):
        return ""
    if len(n) > 200:
        n = n[:200]
    return n


def _company_from_subtitle(subtitle: str) -> str:
    """Employer from headline: 'CEO @ Acme' / 'Manager at Acme' — not the whole designation."""
    raw = re.sub(r"\s+", " ", (subtitle or "")).strip()
    if not raw:
        return ""
    m = _COMPANY_FROM_SUBTITLE_RE.search(raw)
    if not m:
        return ""
    company = _clean_company(m.group(1) or m.group(2) or "")
    if company and company.lower() == raw.lower():
        return ""
    return company


_COMPANY_BRAND = r"([A-Z][A-Za-z0-9&.'’\-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'’\-]{1,40}){0,3})"
_COMPANY_FROM_BODY_PATTERNS = (
    re.compile(rf"\b[Hh]iring(?:\s+[Nn]ow)?\s+[Aa]t\s+{_COMPANY_BRAND}\s*[!.]?"),
    re.compile(
        rf"\b(?:[Jj]oin(?:ing)?|[Tt]eam|[Cc]ompany|[Rr]ole)(?:\s+[a-z0-9'’\-]+){{0,6}}\s+[Aa]t\s+"
        rf"{_COMPANY_BRAND}\s*[!.]?"
    ),
    re.compile(rf"\b[Jj]oin(?:ing)?\s+{_COMPANY_BRAND}\b"),
)
_COMPANY_FILLER_RE = re.compile(
    r"\b(our|growing|team|looking|talented|join|joining|hiring|the|a|an|for|to|at|and|with)\b",
    re.I,
)
_STRIP_HEADER_RE = re.compile(
    r"^(?:Feed post\s+)?.*?•\s+\d+(?:st|nd|rd|th)\+?\s+.+?\s+"
    r"(?:\d+\s*(?:mo|yr|y|[smhdw])|just now|yesterday)\b"
    r"(?:\s*(?:Connect|Follow|Edited))*\s*",
    re.I,
)
_STRIP_MORE_RE = re.compile(r"\s*(?:…|\.{3})\s*more\b[\s\S]*$", re.I)
_STRIP_ENGAGE_RE = re.compile(r"\s+\d{1,4}(?:\s+\d{1,4}){1,3}\s*$")
_POSTS_SLUG_RE = re.compile(r"/posts/([^/?#]+)", re.I)
_IN_SLUG_RE = re.compile(r"/in/([^/?#]+)", re.I)


def _clean_company_candidate(value: str) -> str:
    company = _clean_company(re.sub(r"[!.,;:]+$", "", (value or "")).strip())
    if not company or len(company) < 2 or len(company) > 80:
        return ""
    if re.match(r"^(us|uk|uae|remote|linkedin|me)$", company, re.I):
        return ""
    if _COMPANY_FILLER_RE.search(company) and company != company.upper():
        return ""
    return company


def _company_from_body(text: str) -> str:
    """Employer from post copy: 'Hiring at TechPrysm!' / 'team at BIZSCALE!' / 'Join Acme'."""
    raw = text or ""
    if not raw:
        return ""
    for pattern in _COMPANY_FROM_BODY_PATTERNS:
        m = pattern.search(raw)
        if not m:
            continue
        company = _clean_company_candidate(m.group(1))
        if company:
            return company
    return ""


def _author_from_profile_href(url: str) -> str:
    """'/in/halima-ehsan-…' or '/posts/ayesha-sibtain-abbas-activity-…' → person name."""
    if not url:
        return ""
    path = url
    try:
        from urllib.parse import urlparse, unquote

        path = urlparse(url).path or url
        slug_m = _IN_SLUG_RE.search(path) or _POSTS_SLUG_RE.search(path)
        if not slug_m:
            return ""
        parts = [p for p in unquote(slug_m.group(1)).split("-") if p]
    except Exception:
        return ""
    name_parts: list[str] = []
    for part in parts:
        if part.lower() in {"activity", "ugcpost", "share"}:
            break
        if part.isdigit() or re.fullmatch(r"[a-f0-9]{6,}", part, re.I):
            break
        if not re.fullmatch(r"[A-Za-z][A-Za-z.'’]*", part):
            break
        name_parts.append(part[:1].upper() + part[1:].lower())
        if len(name_parts) >= 4:
            break
    return _clean_author(" ".join(name_parts))


def _strip_post_chrome(text: str) -> str:
    """Drop actor chrome mashed into body; keep real post copy only."""
    t = re.sub(r"\s+", " ", (text or "")).strip()
    if not t:
        return ""
    if _parse_feed_post_header(t):
        stripped = _STRIP_HEADER_RE.sub("", t, count=1).strip()
        if stripped and len(stripped) >= 12:
            t = stripped
    t = _STRIP_MORE_RE.sub("", t).strip()
    t = _STRIP_ENGAGE_RE.sub("", t).strip()
    return t


def _trailing_person_name(before: str) -> str:
    parts = re.sub(r"\s+", " ", (before or "")).strip().split()
    name_parts: list[str] = []
    for tok in reversed(parts):
        cleaned = re.sub(r"[^\w.'’-]", "", tok)
        if not cleaned or cleaned.lower() in _NAME_STOP or not cleaned[0].isalpha():
            break
        name_parts.insert(0, cleaned)
        if len(name_parts) >= 3:
            break
    return " ".join(name_parts)


def _prefer_author(current: str, next_name: str) -> str:
    """Expand last-name-only ('Khan') to full name ('Fatima Khan'); never swallow company words."""
    a = _clean_author(current)
    b = _clean_author(next_name)
    if not b:
        return a
    if not a:
        return b
    a_l, b_l = a.lower(), b.lower()
    if a_l == b_l:
        return a
    a_parts, b_parts = a.split(), b.split()
    if len(a_parts) == 1 and len(b_parts) > 1 and b_l.endswith(f" {a_l}"):
        return b
    if len(b_parts) == 1 and len(a_parts) > 1 and a_l.endswith(f" {b_l}"):
        return a
    return a


def _parse_feed_post_header(text: str) -> dict[str, str] | None:
    raw = re.sub(r"\s+", " ", (text or "")).strip()
    if not raw:
        return None
    m = _FEED_POST_BULLET_RE.search(raw)
    if not m:
        return None
    before = re.sub(r"^(?:Feed post\s+)", "", raw[: m.start()], flags=re.I).strip()
    author = _clean_author(_trailing_person_name(before))
    subtitle = re.sub(r"\s+", " ", m.group(2)).strip()
    subtitle = re.sub(
        r"\s+(Follow|Connect|Edited|•|·\s*Visible to anyone).*$",
        "",
        subtitle,
        flags=re.I,
    ).strip()
    if len(subtitle) > 200:
        subtitle = subtitle[:200]
    posted_at_text = re.sub(r"\s+", " ", m.group(3)).strip()
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


def _strip_url(url: str) -> str:
    return (url or "").strip().split("?", 1)[0].split("#", 1)[0]


def canonicalize_post_url(
    *,
    job_url: str = "",
    linkedin_job_id: str = "",
    list_payload: dict | None = None,
    detail_payload: dict | None = None,
) -> str:
    """Prefer a real post permalink; never keep LinkedIn search-result URLs as source_url.

    Prefer `/posts/...` over reconstructed `/feed/update/urn:...` — the latter often
    404s ("Post not found") for content-search captures even when the post is live.
    """
    detail = detail_payload or {}
    list_p = list_payload or {}
    posts_urls: list[str] = []
    feed_urls: list[str] = []
    for candidate in (
        detail.get("post_url"),
        job_url,
        list_p.get("post_url"),
    ):
        url = _strip_url(candidate or "")
        if not is_post_permalink(url):
            continue
        if re.search(r"/posts/", url, re.I):
            posts_urls.append(url if url.endswith("/") else f"{url}/")
        else:
            feed_urls.append(url if url.endswith("/") else f"{url}/")
    if posts_urls:
        return posts_urls[0]
    if feed_urls:
        return feed_urls[0]

    urn = (list_p.get("urn") or detail.get("urn") or "").strip()
    m = _ACTIVITY_ID_RE.search(urn) or _ACTIVITY_ID_RE.search(linkedin_job_id or "")
    if m:
        blob = f"{urn} {linkedin_job_id}"
        if re.search(r"ugcPost", blob, re.I):
            kind = "ugcPost"
        elif re.search(r"\bshare\b|share:", blob, re.I):
            kind = "share"
        else:
            kind = "activity"
        return permalink_from_activity_id(m.group(1), kind)

    # linkedin_job_id shape from extension: p{activityId} (digits only — never hashed ids)
    if linkedin_job_id and re.fullmatch(r"p\d{6,}", linkedin_job_id):
        return permalink_from_activity_id(linkedin_job_id[1:], "activity")

    url = _strip_url(job_url or "")
    if url and not _SEARCH_URL_RE.search(url):
        return url if url.endswith("/") else f"{url}/"
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
    raw_body = (detail.get("description") or list_p.get("description") or "").strip()
    if len(raw_body) > 20000:
        raw_body = raw_body[:20000]
    # Content-search cards often leave author empty but embed:
    # "Feed post Muhammad Zubair • 2nd {Headline} 2h …"
    if kind in ("post", "search_email"):
        header = _parse_feed_post_header(raw_body)
        if header:
            if header.get("author"):
                author = _prefer_author(author, header["author"])
            if header.get("subtitle") and (not subtitle or len(subtitle) < 8):
                subtitle = header["subtitle"]
            if header.get("posted_at_text") and not posted_at_text:
                posted_at_text = header["posted_at_text"]
        if not author:
            author = _author_from_profile_href(source_url) or _author_from_profile_href(job_url)
        post_body = _strip_post_chrome(raw_body)
        # job.company used to be the whole headline — never treat that as employer.
        if company and subtitle and company.strip().lower() == subtitle.strip().lower():
            company = ""
        # Reject leftover phrase junk like "our growing team at BIZSCA".
        if company and _COMPANY_FILLER_RE.search(company) and company != company.upper():
            company = ""
        company = (
            _company_from_subtitle(subtitle)
            or _company_from_body(post_body)
            or _company_from_body(raw_body)
            or _clean_company_candidate(company)
        )
    else:
        post_body = raw_body
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
            if source_url:
                signals["post_url"] = source_url
            # Poster identity from LinkedIn card/header — never trust near-email
            # guesses like "Working Hours" / "US" / "Google Sheets".
            safe_near_name = "" if _is_junk_author(d.name or "") else (d.name or "").strip()
            poster_name = _prefer_author(author, safe_near_name)[:200]
            # Designation = full headline; company = employer only (at/@), never the headline.
            poster_position = (subtitle or "")[:200]
            poster_company = _clean_company(company)
            if poster_company and poster_position and poster_company.lower() == poster_position.lower():
                poster_company = _company_from_subtitle(poster_position)
            enriched.append(
                CandidateDraft(
                    email=d.email,
                    name=poster_name,
                    company=poster_company,
                    position=poster_position,
                    source_url=source_url or d.source_url or "",
                    source_title=d.source_title or title or author,
                    snippet=d.snippet,
                    score=d.score,
                    signals=signals,
                    selected=bool(poster_name or poster_company or poster_position),
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
