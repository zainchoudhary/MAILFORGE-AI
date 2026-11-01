import hashlib
import hmac
import json
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from app.core.config import get_settings
from app.database.session import get_db
from app.models.entities import Suppression, EmailMessage, EmailEvent

router = APIRouter(tags=["Provider events"])


def unsubscribe_identity(token):
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        if data.get("type") != "unsubscribe":
            raise ValueError()
        return data
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(400, "Invalid unsubscribe link")


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe_page(token: str):
    unsubscribe_identity(token)
    import html

    return (
        '<html><body><h1>Unsubscribe from this organization</h1><form method="post" action="?token='
        + html.escape(token, quote=True)
        + '"><button type="submit">Confirm unsubscribe</button></form></body></html>'
    )


@router.post("/unsubscribe")
def unsubscribe(token: str, db=Depends(get_db)):
    data = unsubscribe_identity(token)
    item = db.scalar(
        select(Suppression).where(
            Suppression.organization_id == data["org"], Suppression.email == data["email"]
        )
    )
    if not item:
        db.add(
            Suppression(
                organization_id=data["org"], email=data["email"], reason="Recipient unsubscribed"
            )
        )
    db.commit()
    return {"unsubscribed": True}


@router.post("/webhooks/provider")
async def provider_event(request: Request, db=Depends(get_db)):
    secret = get_settings().provider_webhook_secret
    if not secret:
        raise HTTPException(503, "Provider event adapter is not configured")
    body = await request.body()
    signature = request.headers.get("x-mailforge-signature", "")
    if not hmac.compare_digest(
        hmac.new(secret.encode(), body, hashlib.sha256).hexdigest(), signature
    ):
        raise HTTPException(401, "Invalid signature")
    try:
        data = json.loads(body)
        if (
            data["kind"] not in ("delivered", "bounced", "opened", "clicked")
            or len(data["event_id"]) > 200
        ):
            raise ValueError()
        msg = db.get(EmailMessage, data["message_id"])
        if not msg:
            raise HTTPException(404, "Message not found")
    except (KeyError, ValueError, TypeError):
        raise HTTPException(422, "Expected event_id, message_id and kind")
    if db.scalar(select(EmailEvent.id).where(EmailEvent.provider_event_id == data["event_id"])):
        return {"duplicate": True}
    db.add(
        EmailEvent(
            organization_id=msg.organization_id,
            message_id=msg.id,
            kind=data["kind"],
            provider_event_id=data["event_id"],
            details={"source": "signed_provider_adapter"},
        )
    )
    rank = {"smtp_accepted": 0, "delivered": 1, "opened": 2, "clicked": 3, "bounced": 4}
    if rank.get(data["kind"], 0) >= rank.get(msg.status, 0):
        msg.status = data["kind"]
    if data["kind"] == "bounced" and not db.scalar(
        select(Suppression.id).where(
            Suppression.organization_id == msg.organization_id,
            Suppression.email == msg.recipient_email,
        )
    ):
        db.add(
            Suppression(
                organization_id=msg.organization_id,
                email=msg.recipient_email,
                reason="Confirmed provider bounce",
            )
        )
    db.commit()
    return {"ok": True}
