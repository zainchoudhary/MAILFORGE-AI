"""Serper and Google Custom Search clients for Lead Finder."""

from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings

_SERPER_URL = "https://google.serper.dev/search"
_GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1"


class LeadSearchConfigError(RuntimeError):
    pass


@dataclass
class SearchHit:
    title: str
    url: str
    snippet: str


def search_web(query: str, num: int = 10, start: int = 0) -> list[SearchHit]:
    """Search the web. ``start`` is a 0-based result offset (Serper ``page``, CSE ``start``)."""
    start = max(0, int(start or 0))
    settings = get_settings()
    provider = (settings.lead_search_provider or "serper").strip().lower()
    timeout = settings.lead_finder_fetch_timeout
    if provider == "serper":
        api_key = (settings.serper_api_key or "").strip()
        if not api_key:
            raise LeadSearchConfigError(
                "Configure SERPER_API_KEY to enable Lead Finder search."
            )
        rows = _serper_search(query, num, api_key, timeout, start)
    elif provider == "google_cse":
        api_key = (settings.google_cse_api_key or "").strip()
        cx = (settings.google_cse_cx or "").strip()
        if not api_key or not cx:
            raise LeadSearchConfigError(
                "Configure GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX to enable Lead Finder search."
            )
        rows = _google_cse_search(query, num, api_key, cx, timeout, start)
    else:
        raise LeadSearchConfigError("LEAD_SEARCH_PROVIDER must be serper or google_cse")
    return _to_hits(rows)


def _serper_search(query: str, num: int, api_key: str, timeout: int, start: int = 0) -> list:
    payload: dict = {"q": query, "num": num}
    if start > 0:
        payload["page"] = start // max(1, num) + 1
    with httpx.Client(timeout=timeout, follow_redirects=True, max_redirects=5) as client:
        response = client.post(
            _SERPER_URL,
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json=payload,
        )
    response.raise_for_status()
    body = response.json()
    organic = body.get("organic") if isinstance(body, dict) else None
    return organic if isinstance(organic, list) else []


def _google_cse_search(
    query: str, num: int, api_key: str, cx: str, timeout: int, start: int = 0
) -> list:
    params: dict = {"key": api_key, "cx": cx, "q": query, "num": num}
    if start > 0:
        params["start"] = start + 1
    with httpx.Client(timeout=timeout, follow_redirects=True, max_redirects=5) as client:
        response = client.get(
            _GOOGLE_CSE_URL,
            params=params,
        )
    response.raise_for_status()
    body = response.json()
    items = body.get("items") if isinstance(body, dict) else None
    return items if isinstance(items, list) else []


def _to_hits(rows: list) -> list[SearchHit]:
    hits: list[SearchHit] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = str(row.get("link") or "").strip()
        if not _is_http_url(url):
            continue
        hits.append(
            SearchHit(
                title=str(row.get("title") or "").strip(),
                url=url,
                snippet=str(row.get("snippet") or "").strip(),
            )
        )
    return hits


def _is_http_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
