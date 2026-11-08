from __future__ import annotations

from app.lead_finder.extract import extract_candidates_from_text
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
    drafts = extract_candidates_from_text(
        text, source_url=job_url or "", source_title=title or "", snippet=text[:400]
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
    return out
