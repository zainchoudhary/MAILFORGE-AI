"""Turn a free-text instruction into a recruiter-focused LeadBrief and search queries."""

import re

from pydantic import BaseModel, Field

from app.agents.orchestrator import invoke_structured, llm  # noqa: F401  (llm re-exported for reuse)
from app.core.config import get_settings
from app.lead_finder.schemas import LeadBrief

DEFAULT_ROLES = ["recruiter", "talent acquisition"]

SYSTEM = (
    "You extract a recruiter-focused lead search brief from the user's instruction. "
    "Only target recruiters, talent acquisition staff, hiring managers and similar hiring contacts "
    "with publicly listed business contact details. Fill roles (job titles to find), location, "
    "industry, keywords (skills or company hints) and exclusions (things to avoid). "
    "target_count is how many leads the user wants. Leave fields empty when not stated. "
    "Never invent email addresses."
)


class _BriefExtraction(BaseModel):
    """Loose schema so an out-of-range LLM count is clamped instead of rejected."""

    roles: list[str] = Field(default_factory=list)
    location: str = ""
    keywords: list[str] = Field(default_factory=list)
    industry: str = ""
    target_count: int | None = None
    exclusions: list[str] = Field(default_factory=list)


def _clamp(count: int) -> int:
    ceiling = max(1, get_settings().lead_finder_max_per_run)
    return max(1, min(int(count), ceiling))


def _clean_list(values: list[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        text = (value or "").strip()
        if text and text.lower() not in (s.lower() for s in seen):
            seen.append(text)
    return seen


def _first_int(instruction: str) -> int | None:
    match = re.search(r"\d+", instruction or "")
    return int(match.group(0)) if match else None


def _fallback(instruction: str, override: int | None) -> LeadBrief:
    count = override if override is not None else _first_int(instruction)
    if count is None:
        count = LeadBrief().target_count
    return LeadBrief(roles=list(DEFAULT_ROLES), target_count=_clamp(count))


def parse_lead_brief(instruction: str, target_count_override: int | None = None) -> LeadBrief:
    from langchain_core.messages import HumanMessage, SystemMessage

    try:
        result = invoke_structured(
            _BriefExtraction,
            [SystemMessage(content=SYSTEM), HumanMessage(content=instruction or "")],
        )
    except Exception:
        return _fallback(instruction, target_count_override)
    if target_count_override is not None:
        count = target_count_override
    elif result.target_count is not None:
        count = result.target_count
    else:
        count = _first_int(instruction) or LeadBrief().target_count
    return LeadBrief(
        roles=_clean_list(result.roles) or list(DEFAULT_ROLES),
        location=(result.location or "").strip(),
        keywords=_clean_list(result.keywords),
        industry=(result.industry or "").strip(),
        target_count=_clamp(count),
        exclusions=_clean_list(result.exclusions),
    )


_RECRUITING_RE = re.compile(r"recruit|talent acquisition", re.IGNORECASE)


def build_search_queries(brief: LeadBrief) -> list[str]:
    """3-6 queries biased to public team/about/careers pages. Never targets login-walled sites."""
    roles = _clean_list(brief.roles) or list(DEFAULT_ROLES)
    primary = roles[0]
    context = " ".join(
        part for part in [brief.location.strip(), brief.industry.strip(), *brief.keywords] if part
    ).strip()
    keywords = " ".join(brief.keywords).strip()
    queries = [
        f"{primary} email {context}",
        f"{primary} contact {keywords or brief.industry.strip()} team about",
        f"{primary} careers contact {context}",
        f"talent acquisition recruiter email {context}",
        f"recruiter contact email team page {context}",
    ]
    if len(roles) > 1:
        queries.insert(1, f"{roles[1]} email {context}")
    ordered: list[str] = []
    for query in queries:
        text = re.sub(r"\s+", " ", query).strip()
        if text and not _RECRUITING_RE.search(text):
            text = f"{text} recruiter"  # every query keeps a recruiting bias
        if text and text.lower() not in (q.lower() for q in ordered):
            ordered.append(text)
    exclusions = " ".join(f'-"{e}"' for e in _clean_list(brief.exclusions))
    if exclusions:
        ordered = [f"{q} {exclusions}" for q in ordered]
    return ordered[:6]
