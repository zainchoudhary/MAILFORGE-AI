import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import delete, select
from app.database.session import get_db
from app.security.auth import current_user, editor
from app.schemas.inputs import CampaignInput, Approval, TestEmail
from app.models.entities import (
    Campaign,
    EmailMessage,
    EmailEvent,
    CampaignRecipient,
    DeliveryAttempt,
    ScheduledCampaign,
    Attachment,
    Document,
    now,
)
from app.repositories.common import owned, serialize, page, audit
from app.services import campaigns as service

router = APIRouter(tags=["Campaigns"])


@router.get("/campaigns")
def campaigns(
    q: str = "",
    status: str = "",
    page_number: int = Query(1, ge=1, alias="page"),
    limit: int = Query(25, ge=1, le=100),
    user=Depends(current_user),
    db=Depends(get_db),
):
    conditions = []
    if q:
        conditions.append(Campaign.name.ilike(f"%{q}%"))
    if status:
        conditions.append(Campaign.status == status)
    return page(db, Campaign, user.organization_id, page_number, limit, conditions)


@router.post("/campaigns", status_code=201)
@router.post("/emails/compose", status_code=201)
def create(data: CampaignInput, user=Depends(editor), db=Depends(get_db)):
    return serialize(service.save(db, user, data))


@router.get("/campaigns/{identifier}")
def detail(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    return service.detail(db, owned(db, Campaign, identifier, user.organization_id))


@router.put("/campaigns/{identifier}")
def update(identifier: str, data: CampaignInput, user=Depends(editor), db=Depends(get_db)):
    return serialize(
        service.save(db, user, data, owned(db, Campaign, identifier, user.organization_id))
    )


@router.delete("/campaigns/{identifier}")
def delete_campaign(identifier: str, user=Depends(editor), db=Depends(get_db)):
    item = owned(db, Campaign, identifier, user.organization_id)
    if item.status in ("processing", "sending", "scheduled"):
        raise HTTPException(409, "Pause or cancel an active campaign before deleting it")
    message_ids = select(EmailMessage.id).where(EmailMessage.campaign_id == item.id)
    db.execute(delete(DeliveryAttempt).where(DeliveryAttempt.message_id.in_(message_ids)))
    db.execute(delete(EmailEvent).where(EmailEvent.message_id.in_(message_ids)))
    # Message attachments have message_id set and campaign_id unset.
    db.execute(delete(Attachment).where(Attachment.message_id.in_(message_ids)))
    db.execute(delete(Attachment).where(Attachment.campaign_id == item.id))
    db.execute(delete(EmailMessage).where(EmailMessage.campaign_id == item.id))
    db.execute(delete(CampaignRecipient).where(CampaignRecipient.campaign_id == item.id))
    db.execute(delete(ScheduledCampaign).where(ScheduledCampaign.campaign_id == item.id))
    db.delete(item)
    audit(db, user, "campaign.deleted", identifier)
    db.commit()
    return {"ok": True}


@router.get("/campaigns/{identifier}/preview")
def preview(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    return {"items": service.preview(db, owned(db, Campaign, identifier, user.organization_id))}


@router.post("/campaigns/{identifier}/review")
def review(identifier: str, data: Approval, user=Depends(editor), db=Depends(get_db)):
    item = owned(db, Campaign, identifier, user.organization_id)
    if item.status != "draft" or data.revision != item.revision:
        raise HTTPException(409, "Campaign changed; review its current revision")
    if not service.preview(db, item):
        raise HTTPException(422, "Select at least one recipient")
    item.reviewed_revision = item.revision
    audit(db, user, "campaign.recipients_reviewed", item.id, {"revision": item.revision})
    db.commit()
    return serialize(item)


@router.post("/campaigns/{identifier}/dry-run")
def dry_run(identifier: str, user=Depends(editor), db=Depends(get_db)):
    item = owned(db, Campaign, identifier, user.organization_id)
    if item.status != "draft":
        raise HTTPException(409, "Dry runs are available for drafts")
    previews = service.preview(db, item)
    if not previews:
        raise HTTPException(422, "Add recipients first")
    item.dry_run_revision = item.revision
    audit(
        db, user, "campaign.dry_run", item.id, {"revision": item.revision, "count": len(previews)}
    )
    db.commit()
    return {
        "dry_run": True,
        "sent": 0,
        "revision": item.revision,
        "items": previews,
        "warnings": (
            ["Some selected addresses are on the suppression list and may be skipped at send time"]
            if any(p.get("suppressed") for p in previews)
            else []
        ),
    }


@router.post("/campaigns/{identifier}/approve")
def approve(identifier: str, data: Approval, user=Depends(editor), db=Depends(get_db)):
    campaign = service.approve(db, user, owned(db, Campaign, identifier, user.organization_id), data)
    # Queue this campaign's messages immediately; beat remains a recovery path.
    from app.workers.tasks import queue_campaign_delivery

    queue_campaign_delivery(campaign.id)
    return serialize(campaign)


@router.post("/campaigns/{identifier}/duplicate", status_code=201)
def duplicate(identifier: str, user=Depends(editor), db=Depends(get_db)):
    source = service.detail(db, owned(db, Campaign, identifier, user.organization_id))
    data = CampaignInput(
        name=source["name"] + " (copy)",
        description=source["description"],
        subject=source["subject"],
        body=source["body"],
        recipient_ids=[r["id"] for r in source["recipients"]],
        recipient_templates={
            r["id"]: r["template_id"] for r in source["recipients"] if r["template_id"]
        },
        attachment_ids=[a["id"] for a in source["attachments"]],
        smtp_account_id=source["smtp_account_id"],
        cc=source["cc"],
        bcc=source["bcc"],
    )
    return serialize(service.save(db, user, data))


@router.post("/campaigns/{identifier}/{action}")
def action(identifier: str, action: str, user=Depends(editor), db=Depends(get_db)):
    item = db.scalar(
        select(Campaign)
        .where(Campaign.id == identifier, Campaign.organization_id == user.organization_id)
        .with_for_update()
    )
    if not item:
        raise HTTPException(404, "Campaign not found")
    if action == "pause" and item.status in ("processing", "sending", "scheduled"):
        item.status = "paused"
    elif action == "resume" and item.status == "paused":
        item.status = (
            "scheduled" if item.scheduled_at and item.scheduled_at > now() else "processing"
        )
    elif action == "cancel" and item.status in (
        "draft",
        "paused",
        "scheduled",
        "processing",
        "sending",
    ):
        item.status = "cancelled"
        for msg in db.scalars(
            select(EmailMessage).where(
                EmailMessage.campaign_id == item.id, EmailMessage.status == "queued"
            )
        ):
            msg.status = "cancelled"
            db.add(
                EmailEvent(
                    organization_id=user.organization_id, message_id=msg.id, kind="cancelled"
                )
            )
    elif action == "retry" and item.status in ("failed", "partially_completed"):
        eligible = []
        for msg in db.scalars(
            select(EmailMessage).where(
                EmailMessage.campaign_id == item.id, EmailMessage.status == "failed"
            )
        ):
            attempt = db.scalar(
                select(DeliveryAttempt)
                .where(DeliveryAttempt.message_id == msg.id)
                .order_by(DeliveryAttempt.created_at.desc())
                .limit(1)
            )
            # Only explicit 4xx rejections are safe automatic retry candidates.
            if attempt and attempt.response and attempt.response.lstrip("(").startswith("4"):
                eligible.append(msg)
        if not eligible:
            raise HTTPException(
                409, "No explicitly rejected transient failures are eligible for retry"
            )
        for msg in eligible:
            msg.status = "queued"
            msg.next_attempt_at = None
        item.status = "processing"
        item.completed_at = None
    else:
        raise HTTPException(409, "Action is unavailable for this campaign state")
    audit(db, user, "campaign." + action, item.id)
    db.commit()
    return serialize(item)


@router.get("/campaigns/{identifier}/report")
def report(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    owned(db, Campaign, identifier, user.organization_id)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["Email ID", "Recipient", "Subject", "Status", "Attempts", "SMTP response", "Error"]
    )

    def safe(value):
        value = str(value or "")
        return "'" + value if value.startswith(("=", "+", "-", "@", "\t", "\r")) else value

    for msg in db.scalars(select(EmailMessage).where(EmailMessage.campaign_id == identifier)):
        writer.writerow(
            [
                safe(v)
                for v in (
                    msg.id,
                    msg.recipient_email,
                    msg.subject,
                    msg.status,
                    msg.attempts,
                    msg.smtp_response,
                    msg.error,
                )
            ]
        )
    return Response(
        buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="campaign-{identifier}.csv"'},
    )


@router.get("/emails", tags=["Email Activity"])
def emails(
    q: str = "",
    status: str = "",
    campaign_id: str = "",
    sort: str = "newest",
    page_number: int = Query(1, ge=1, alias="page"),
    limit: int = Query(25, ge=1, le=100),
    user=Depends(current_user),
    db=Depends(get_db),
):
    conditions = []
    if q:
        conditions.append(
            EmailMessage.recipient_email.ilike(f"%{q}%") | EmailMessage.subject.ilike(f"%{q}%")
        )
    if status:
        conditions.append(EmailMessage.status == status)
    if campaign_id:
        conditions.append(EmailMessage.campaign_id == campaign_id)
    if sort not in ("newest", "oldest", "recipient"):
        raise HTTPException(422, "Invalid sort order")
    order = {
        "newest": EmailMessage.created_at.desc(),
        "oldest": EmailMessage.created_at.asc(),
        "recipient": EmailMessage.recipient_email.asc(),
    }[sort]
    return page(db, EmailMessage, user.organization_id, page_number, limit, conditions, order)


@router.get("/emails/{identifier}", tags=["Email Activity"])
def email_detail(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    item = owned(db, EmailMessage, identifier, user.organization_id)
    return {
        **serialize(item),
        "attempts_history": [
            serialize(a)
            for a in db.scalars(
                select(DeliveryAttempt)
                .where(DeliveryAttempt.message_id == item.id)
                .order_by(DeliveryAttempt.created_at)
            )
        ],
        "events": [
            serialize(a)
            for a in db.scalars(
                select(EmailEvent)
                .where(EmailEvent.message_id == item.id)
                .order_by(EmailEvent.created_at)
            )
        ],
        "attachments": [
            serialize(d, ("storage_key",))
            for d in db.scalars(
                select(Document)
                .join(Attachment, Attachment.document_id == Document.id)
                .where(Attachment.message_id == item.id)
            )
        ],
    }


@router.post("/emails/send-test", tags=["Email Activity"])
def test_email(data: TestEmail, user=Depends(editor), db=Depends(get_db)):
    from app.models.entities import Recipient

    source = owned(db, Campaign, data.campaign_id, user.organization_id)
    if str(data.recipient).lower() != user.email:
        raise HTTPException(422, "Test emails may only be addressed to your signed-in account")
    recipient = db.scalar(
        select(Recipient).where(
            Recipient.organization_id == user.organization_id, Recipient.email == user.email
        )
    )
    if not recipient:
        recipient = Recipient(
            organization_id=user.organization_id, email=user.email, name=user.name
        )
        db.add(recipient)
        db.flush()
    test = service.save(
        db,
        user,
        CampaignInput(
            name="Test: " + source.name,
            subject=source.subject,
            body=source.body,
            recipient_ids=[recipient.id],
            smtp_account_id=source.smtp_account_id,
            attachment_ids=[a["id"] for a in service.detail(db, source)["attachments"]],
        ),
    )
    test.reviewed_revision = test.revision
    test.dry_run_revision = test.revision
    audit(db, user, "email.test_preflight", test.id)
    db.commit()
    from app.core.config import get_settings

    if get_settings().dry_run:
        return {
            "dry_run": True,
            "sent": 0,
            "campaign_id": test.id,
            "preview": service.preview(db, test),
        }
    service.approve(db, user, test, Approval(revision=test.revision, confirm=True))
    return {"queued": True, "campaign_id": test.id}
