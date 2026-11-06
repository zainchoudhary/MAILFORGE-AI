"""Pull recruiter candidates out of page text. Emails come only from the text."""

import re

from app.lead_finder.schemas import CandidateDraft

_EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+\-']+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z0-9]{2,63}"
)
_NAME_RE = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,6})\b")
_COMPANY_RE = re.compile(
    r"\b(?:at|with|from)\s+([A-Z][A-Za-z0-9&]+(?:\s+[A-Z][A-Za-z0-9&]+){0,3})"
)
_POSITION_RE = re.compile(
    r"\b((?:(?:senior|junior|lead|head|principal|technical|corporate|campus|executive|it|hr)\s+){0,3}"
    r"(?:talent acquisition|talent partner|hiring managers?|people operations|people ops|recruiters?|ta))\b",
    re.IGNORECASE,
)
_TITLE_PATTERNS = (
    ("talent acquisition", re.compile(r"\btalent acquisition\b", re.IGNORECASE)),
    ("talent partner", re.compile(r"\btalent partner\b", re.IGNORECASE)),
    ("hiring manager", re.compile(r"\bhiring managers?\b", re.IGNORECASE)),
    ("people operations", re.compile(r"\bpeople operations\b", re.IGNORECASE)),
    ("people ops", re.compile(r"\bpeople ops\b", re.IGNORECASE)),
    ("recruiter", re.compile(r"\brecruiters?\b", re.IGNORECASE)),
    ("ta", re.compile(r"\bta\b", re.IGNORECASE)),
)
_HARD_REJECT_LOCALS = frozenset(
    {"noreply", "donotreply", "mailerdaemon", "postmaster", "bounce", "bounces"}
)
_ASSET_TLDS = frozenset(
    {
        "png",
        "jpg",
        "jpeg",
        "gif",
        "svg",
        "webp",
        "css",
        "js",
        "ico",
        "map",
        "woff",
        "woff2",
        "ttf",
        "eot",
        "otf",
        "avif",
        "bmp",
        "tiff",
        "tif",
        "mp4",
        "webm",
        "pdf",
        "mp3",
        "wav",
        "ogg",
        "mov",
        "avi",
        "mkv",
        "mpeg",
        "mpg",
        "m4v",
        "m4a",
        "flac",
        "aac",
    }
)
_NAME_LEADING = frozenset({"email", "contact", "reach", "visit", "meet"})
_NAME_STOP = frozenset(
    {
        "our",
        "your",
        "the",
        "and",
        "for",
        "with",
        "from",
        "get",
        "got",
        "started",
        "start",
        "team",
        "teams",
        "page",
        "pages",
        "home",
        "about",
        "us",
        "click",
        "here",
        "learn",
        "more",
        "read",
        "view",
        "see",
        "join",
        "apply",
        "welcome",
        "hello",
        "sign",
        "login",
        "signup",
        "subscribe",
        "follow",
        "download",
        "menu",
        "privacy",
        "policy",
        "terms",
        "support",
        "help",
        "info",
        "information",
        "press",
        "media",
        "blog",
        "news",
        "search",
        "website",
        "site",
        "services",
        "service",
        "company",
        "careers",
        "jobs",
        "footer",
        "header",
        "navigation",
        "nav",
        "back",
        "next",
        "previous",
        "all",
        "new",
        "now",
        "free",
        "open",
        "work",
        "this",
        "that",
        "please",
        "just",
        "today",
        "call",
        "email",
        "contact",
        "reach",
        "visit",
        "meet",
    }
)
_RETINA_LABEL = re.compile(r"\d+x")
_TITLE_SCORE = 1.0
_GENERIC_LOCALS = frozenset({"info", "careers", "jobs", "hr"})
_ROLE_WORDS = frozenset(
    {
        "recruiter",
        "recruiters",
        "talent",
        "acquisition",
        "partner",
        "hiring",
        "manager",
        "managers",
        "people",
        "ops",
        "operations",
        "technical",
        "senior",
        "junior",
        "lead",
        "head",
        "principal",
        "corporate",
        "campus",
        "executive",
        "it",
        "hr",
        "ta",
    }
)
_FREE_MAIL = frozenset(
    {
        "gmail",
        "googlemail",
        "yahoo",
        "outlook",
        "hotmail",
        "live",
        "icloud",
        "aol",
        "proton",
        "protonmail",
        "pm",
        "msn",
        "me",
        "gmx",
    }
)
_WINDOW_BEFORE = 400
_WINDOW_AFTER = 200


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_hard_rejected_email(email: str) -> bool:
    normalized = normalize_email(email)
    if "@" not in normalized:
        return False
    local = normalized.split("@", 1)[0]
    return _normalized_reject_local(local) in _HARD_REJECT_LOCALS


def extract_candidates_from_text(
    text: str,
    *,
    source_url: str,
    source_title: str = "",
    snippet: str = "",
) -> list[CandidateDraft]:
    raw = text or ""
    matches: list[tuple[re.Match[str], str]] = []
    for match in _EMAIL_RE.finditer(raw):
        email = _accept_email(match.group(0))
        if not email or is_hard_rejected_email(email):
            continue
        matches.append((match, email))
    drafts: list[CandidateDraft] = []
    seen: set[str] = set()
    for index, (match, email) in enumerate(matches):
        if email in seen:
            continue
        prev_end = matches[index - 1][0].end() if index else 0
        start = max(prev_end, match.start() - _WINDOW_BEFORE)
        # Text between two nearby addresses introduces the later one.
        forward_limit = min(len(raw), match.end() + _WINDOW_AFTER)
        next_is_near = (
            index + 1 < len(matches) and matches[index + 1][0].start() <= forward_limit
        )
        end = match.end() if next_is_near else forward_limit
        window = raw[start:end]
        anchor = match.start() - start
        name = _closest_name(window, anchor)
        company = _closest_company(window, anchor) or _company_from_domain(email)
        if not name and not company:
            continue
        seen.add(email)
        position = _position(window)
        title = _matched_title(window)
        person_like = _person_like(name)
        generic = email.split("@", 1)[0] in _GENERIC_LOCALS
        selected = bool(title) and not (generic and not person_like)
        signals: dict = {}
        if title:
            signals["title"] = title
        if generic and not person_like:
            signals["generic_inbox"] = True
        drafts.append(
            CandidateDraft(
                email=email,
                name=name,
                company=company,
                position=position,
                source_url=source_url,
                source_title=source_title,
                snippet=snippet.strip() or _compact(window),
                signals=signals,
                selected=selected,
                score=_TITLE_SCORE if title else 0.0,
            )
        )
    return drafts


def _normalized_reject_local(local: str) -> str:
    local = local.split("+", 1)[0]
    return re.sub(r"[-_.']", "", local)


def _accept_email(raw: str) -> str:
    email = normalize_email(raw.strip(".,;:<>\"'()[]{}"))
    if email.count("@") != 1:
        return ""
    local, domain = email.split("@", 1)
    local = re.sub(r"^[^a-z0-9]+", "", local)
    if not re.fullmatch(r"[a-z0-9][a-z0-9._%+\-']*", local):
        return ""
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z0-9]{2,63}", domain):
        return ""
    tld = domain.rsplit(".", 1)[-1]
    if tld in _ASSET_TLDS or not tld.isalpha():
        return ""
    return f"{local}@{domain}"


def _closest_name(window: str, anchor: int) -> str:
    best = ""
    best_distance: int | None = None
    for match in _NAME_RE.finditer(window):
        phrase = _clean_name(match.group(1))
        if not phrase:
            continue
        distance = abs(match.start() - anchor)
        if best_distance is None or distance < best_distance:
            best = phrase
            best_distance = distance
    return best


def _clean_name(phrase: str) -> str:
    words = phrase.split()
    while words and _is_name_prefix(words[0]):
        words.pop(0)
    while words and _is_name_suffix(words[-1]):
        words.pop()
    cleaned = " ".join(words)
    if not _person_like(cleaned):
        return ""
    return cleaned


def _is_name_prefix(word: str) -> bool:
    token = _name_word(word)
    return token in _NAME_LEADING or token in _ROLE_WORDS or token in _NAME_STOP


def _is_name_suffix(word: str) -> bool:
    token = _name_word(word)
    return token in _ROLE_WORDS or token in _NAME_STOP


def _name_word(word: str) -> str:
    return re.sub(r"[^a-z]", "", word.lower())


def _closest_company(window: str, anchor: int) -> str:
    best = ""
    best_distance: int | None = None
    for match in _COMPANY_RE.finditer(window):
        phrase = match.group(1).strip()
        if not phrase or _is_role_phrase(phrase):
            continue
        distance = abs(match.start() - anchor)
        if best_distance is None or distance < best_distance:
            best = phrase
            best_distance = distance
    return best


def _company_from_domain(email: str) -> str:
    labels = email.split("@", 1)[1].split(".")
    stem = labels[0]
    if stem in {"www", "mail", "email"} and len(labels) > 2:
        stem = labels[1]
    if len(stem) < 2 or stem in _FREE_MAIL or _RETINA_LABEL.fullmatch(stem):
        return ""
    return stem[:1].upper() + stem[1:]


def _position(window: str) -> str:
    match = _POSITION_RE.search(window)
    return _compact(match.group(1)) if match else ""


def _matched_title(window: str) -> str:
    for label, pattern in _TITLE_PATTERNS:
        if pattern.search(window):
            return label
    return ""


def _person_like(name: str) -> bool:
    parts = name.split()
    if not 2 <= len(parts) <= 3 or _is_role_phrase(name):
        return False
    if any(_name_word(part) in _NAME_STOP for part in parts):
        return False
    return all(re.fullmatch(r"[A-Z][a-z'’-]+", part) for part in parts)


def _is_role_phrase(phrase: str) -> bool:
    words = [re.sub(r"[^a-z]", "", word.lower()) for word in phrase.split()]
    return bool(words) and all(word in _ROLE_WORDS for word in words)


def _compact(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()[:500]
