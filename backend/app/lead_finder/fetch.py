"""Fetch a public page and reduce it to text for lead extraction."""

import ipaddress
import re
import socket
import time
from html import unescape

import httpx

from app.core.config import get_settings

_SCRIPT_RE = re.compile(r"(?is)<script\b[^>]*>.*?</script>")
_STYLE_RE = re.compile(r"(?is)<style\b[^>]*>.*?</style>")
_COMMENT_RE = re.compile(r"(?is)<!--.*?-->")
_TAG_RE = re.compile(r"(?is)<[^>]+>")
_WS_RE = re.compile(r"\s+")
_MAX_REDIRECTS = 5
_TEXT_TYPES = ("text/html", "application/xhtml+xml", "text/plain")


def fetch_page_text(url: str) -> str | None:
    """Return page text, or None when the URL is unsafe, not text, too slow or not 2xx.

    Redirects are followed manually (at most ``_MAX_REDIRECTS`` hops) so every hop is checked
    against the public-host guard; the body is streamed and cut at
    ``lead_finder_max_page_bytes`` within a wall-clock budget of ``lead_finder_fetch_timeout``.
    """
    settings = get_settings()
    timeout = settings.lead_finder_fetch_timeout
    max_bytes = max(0, settings.lead_finder_max_page_bytes)
    deadline = time.monotonic() + timeout
    try:
        with _client(timeout) as client:
            for _ in range(_MAX_REDIRECTS + 1):
                if not is_fetch_allowed(url):
                    return None
                with client.stream("GET", url) as response:
                    if response.is_redirect:
                        url = str(response.url.join(response.headers["location"]))
                        continue
                    if response.status_code < 200 or response.status_code >= 300:
                        return None
                    if not _is_text(response.headers.get("content-type")):
                        return None
                    raw = _read_capped(response, max_bytes, deadline)
                    if raw is None:
                        return None
                    return _html_to_text(_decode(raw, response.encoding))
    except (httpx.HTTPError, httpx.InvalidURL, OSError, ValueError):
        return None
    return None


def _client(timeout: float) -> httpx.Client:
    return httpx.Client(timeout=timeout, follow_redirects=False)


def is_fetch_allowed(url: str) -> bool:
    """http(s) only, and the host must resolve solely to global addresses unless allowed."""
    try:
        parsed = httpx.URL(url)
    except (httpx.InvalidURL, TypeError, ValueError):
        return False
    if parsed.scheme not in ("http", "https") or not parsed.host:
        return False
    if get_settings().lead_finder_allow_private_fetch:
        return True
    try:
        entries = socket.getaddrinfo(parsed.host, parsed.port or None)
        return bool(entries) and all(
            ipaddress.ip_address(entry[4][0]).is_global for entry in entries
        )
    except (OSError, ValueError):
        return False


def _is_text(content_type: str | None) -> bool:
    if not content_type:
        return True
    return content_type.split(";", 1)[0].strip().lower() in _TEXT_TYPES


def _read_capped(response: httpx.Response, max_bytes: int, deadline: float) -> bytes | None:
    chunks: list[bytes] = []
    size = 0
    for chunk in response.iter_bytes():
        if time.monotonic() > deadline:
            return None
        chunks.append(chunk)
        size += len(chunk)
        if size >= max_bytes:
            break
    return b"".join(chunks)[:max_bytes]


def _decode(raw: bytes, encoding: str | None) -> str:
    charset = encoding or "utf-8"
    try:
        return raw.decode(charset, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


def _html_to_text(html: str) -> str:
    cleaned = _SCRIPT_RE.sub(" ", html)
    cleaned = _STYLE_RE.sub(" ", cleaned)
    cleaned = _COMMENT_RE.sub(" ", cleaned)
    cleaned = _TAG_RE.sub(" ", cleaned)
    cleaned = unescape(cleaned)
    return _WS_RE.sub(" ", cleaned).strip()
