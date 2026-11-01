import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from app.database.session import get_db, SessionLocal
from app.security.auth import current_user, editor
from app.schemas.inputs import AIInput
from app.agents.orchestrator import AIProviderError, execute
from app.analytics import queries
from app.models.entities import Campaign, Document, EmailMessage
from app.repositories.common import owned

router = APIRouter()


def local_email_draft(data: AIInput):
    instruction = data.instruction.strip()
    lowered = instruction.lower()
    if "hiring" in lowered and ("ai engineer" in lowered or "machine learning" in lowered):
        return {
            "subject": "We are hiring: AI Engineer",
            "body": (
                "<p>Hi,</p>"
                "<p>We are looking for a talented AI Engineer to join our team and help us build "
                "practical, reliable AI products.</p>"
                "<p>In this role, you will design and deploy machine-learning solutions, work with "
                "large language models, and collaborate with product and engineering teams to turn "
                "ideas into production-ready systems.</p>"
                "<p>If you are interested, please reply with your resume and a short introduction "
                "about your experience. We would be happy to share more details about the role.</p>"
                "<p>Best,<br />The Hiring Team</p>"
            ),
        }
    subject = data.subject.strip() or "A quick introduction"
    if data.body.strip():
        return {"subject": subject, "body": data.body}
    return {
        "subject": subject,
        "body": "<p>Hi,</p><p>I wanted to get in touch and share a quick introduction.</p>"
        "<p>Please let me know if you would be open to a conversation.</p><p>Best,</p>",
    }


@router.get("/analytics/overview", tags=["Analytics"])
def overview(user=Depends(current_user), db=Depends(get_db)):
    return queries.overview(db, user.organization_id)


@router.get("/analytics/emails", tags=["Analytics"])
def activity(days: int = 30, user=Depends(current_user), db=Depends(get_db)):
    if not 1 <= days <= 366:
        raise HTTPException(422, "Days must be 1–366")
    return {"items": queries.activity(db, user.organization_id, days)}


@router.get("/analytics/campaigns", tags=["Analytics"])
def campaigns(user=Depends(current_user), db=Depends(get_db)):
    return {"items": queries.campaigns(db, user.organization_id)}


@router.post("/ai/compose", tags=["AI"])
def compose(data: AIInput, user=Depends(editor), db=Depends(get_db)):
    try:
        return execute(db, user.organization_id, "compose", data.model_dump())
    except (ValueError, AIProviderError) as error:
        # Keep the compose workflow usable when no provider key is configured.
        # A configured Groq/Gemini provider still takes the primary path above.
        draft = local_email_draft(data)
        return {
            **draft,
            "explanation": "Local draft created because no AI provider is currently available.",
            "ai_fallback": True,
            "provider_error": str(error),
        }


@router.post("/ai/analyze-document", tags=["AI"])
def analyze(data: AIInput, user=Depends(editor), db=Depends(get_db)):
    from app.api.v1.resources import extract

    return {"extractions": [extract(identifier, user, db) for identifier in data.document_ids]}


@router.post("/ai/campaign-assistant", tags=["AI"])
def assistant(data: AIInput, user=Depends(editor), db=Depends(get_db)):
    if data.campaign_id:
        owned(db, Campaign, data.campaign_id, user.organization_id)
    for identifier in data.document_ids:
        owned(db, Document, identifier, user.organization_id)
    try:
        result = execute(
            db,
            user.organization_id,
            "analytics" if data.action == "analytics" else "copilot",
            data.model_dump(),
        )
        # Attach actual database results for supported inspection requests.
        if "fail" in data.instruction.lower():
            result["failed_emails"] = [
                {"id": m.id, "recipient": m.recipient_email, "error": m.error}
                for m in db.scalars(
                    select(EmailMessage)
                    .where(
                        EmailMessage.organization_id == user.organization_id,
                        EmailMessage.status.in_(["failed", "uncertain"]),
                    )
                    .limit(25)
                )
            ]
        if data.document_ids:
            from app.api.v1.resources import extract

            result["extractions"] = [extract(i, user, db) for i in data.document_ids]
        if result.get("subject") and result.get("body"):
            from app.schemas.inputs import CampaignInput
            from app.services.campaigns import save

            draft = save(
                db,
                user,
                CampaignInput(
                    name="Copilot draft: " + result["subject"][:160],
                    subject=result["subject"],
                    body=result["body"],
                ),
            )
            result["draft_campaign_id"] = draft.id
        return result
    except (ValueError, AIProviderError) as error:
        raise HTTPException(503, str(error))


@router.get("/events", tags=["Realtime"])
async def events(request: Request, user=Depends(current_user)):
    org = user.organization_id

    def snapshot():
        with SessionLocal() as db:
            return queries.overview(db, org)

    async def stream():
        # Short connections re-authenticate on reconnect rather than retaining expired JWTs.
        for _ in range(12):
            if await request.is_disconnected():
                break
            data = await asyncio.to_thread(snapshot)
            yield "event: metrics\ndata: " + json.dumps(jsonable_encoder(data)) + "\n\n"
            await asyncio.sleep(5)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/ai/delivery-status", tags=["AI"])
def delivery_status(data: AIInput, user=Depends(current_user), db=Depends(get_db)):
    if not data.campaign_id:
        raise HTTPException(422, "Campaign ID required")
    return execute(db, user.organization_id, "delivery", data.model_dump())
