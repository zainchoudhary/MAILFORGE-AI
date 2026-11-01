import logging
import smtplib
from datetime import timedelta
import jwt
from redis import Redis
from sqlalchemy import select, func
from app.workers.celery_app import celery
from app.core.config import get_settings
from app.database.session import SessionLocal
from app.models.entities import (
    Campaign,
    EmailMessage,
    Recipient,
    SMTPAccount,
    Document,
    Attachment,
    DeliveryAttempt,
    EmailEvent,
    ScheduledCampaign,
    Extraction,
    now,
)
from app.services.campaigns import eligible
from app.integrations.smtp import send

logger = logging.getLogger(__name__)


@celery.task
def dispatch():
    with SessionLocal() as db:
        for schedule in db.scalars(
            select(ScheduledCampaign)
            .where(ScheduledCampaign.dispatched.is_(False), ScheduledCampaign.due_at <= now())
            .with_for_update(skip_locked=True)
        ):
            campaign = db.get(Campaign, schedule.campaign_id)
            if campaign.status == "scheduled":
                campaign.status = "processing"
                schedule.dispatched = True
        # A crashed process may have sent DATA. Do not retry an uncertain outcome automatically.
        for msg in db.scalars(
            select(EmailMessage)
            .where(EmailMessage.status == "sending", EmailMessage.lease_until < now())
            .with_for_update(skip_locked=True)
        ):
            msg.status = "uncertain"
            msg.error = "Worker interrupted during SMTP transaction; verify with provider before any manual resend"
            db.add(
                EmailEvent(organization_id=msg.organization_id, message_id=msg.id, kind="uncertain")
            )
        for extraction in db.scalars(
            select(Extraction)
            .where(
                Extraction.status == "processing",
                Extraction.created_at < now() - timedelta(minutes=15),
            )
            .with_for_update(skip_locked=True)
        ):
            extraction.status = "failed"
            extraction.error = "Extraction exceeded its execution window; retry the document."
        db.commit()
        for campaign in db.scalars(
            select(Campaign).where(Campaign.status.in_(["processing", "sending"]))
        ):
            finish(db, campaign)
        ids = db.scalars(
            select(EmailMessage.id)
            .join(Campaign)
            .where(
                Campaign.status.in_(["processing", "sending"]),
                EmailMessage.status == "queued",
                (EmailMessage.next_attempt_at.is_(None)) | (EmailMessage.next_attempt_at <= now()),
            )
            .limit(100)
        ).all()
    for identifier in ids:
        deliver.delay(identifier)


@celery.task
def deliver(identifier):
    s = get_settings()
    with SessionLocal() as db:
        campaign_id = db.scalar(
            select(EmailMessage.campaign_id).where(EmailMessage.id == identifier)
        )
        if not campaign_id:
            return
        # All delivery and control mutations lock campaign before message.
        campaign = db.scalar(select(Campaign).where(Campaign.id == campaign_id).with_for_update())
        msg = db.scalar(select(EmailMessage).where(EmailMessage.id == identifier).with_for_update())
        if (
            not msg
            or msg.status != "queued"
            or (msg.next_attempt_at and msg.next_attempt_at > now())
        ):
            return
        if (
            campaign.status not in ("processing", "sending")
            or not campaign.approved_at
            or s.dry_run
        ):
            return
        recipients = [db.get(Recipient, msg.recipient_id)]
        recipients += [
            db.scalar(
                select(Recipient).where(
                    Recipient.organization_id == msg.organization_id,
                    Recipient.email == email.lower(),
                )
            )
            for email in [*campaign.cc, *campaign.bcc]
        ]
        if any(
            not recipient or not eligible(db, msg.organization_id, recipient)
            for recipient in recipients
        ):
            msg.status = "cancelled"
            msg.error = "Recipient consent revoked or address suppressed"
            db.commit()
            finish(db, campaign)
            return
        limiter = Redis.from_url(s.redis_url)
        if not limiter.set(
            f"send-rate:{msg.organization_id}",
            identifier,
            nx=True,
            px=max(1, int(s.delay_between_emails * 1000)),
        ):
            return
        msg.status = "sending"
        msg.attempts += 1
        msg.lease_until = now() + timedelta(minutes=5)
        campaign.status = "sending"
        campaign.started_at = campaign.started_at or now()
        attempt = DeliveryAttempt(
            organization_id=msg.organization_id,
            message_id=msg.id,
            number=msg.attempts,
            status="sending",
        )
        db.add(attempt)
        db.commit()
        try:
            account = db.get(SMTPAccount, campaign.smtp_account_id)
            docs = db.scalars(
                select(Document)
                .join(Attachment, Attachment.document_id == Document.id)
                .where(Attachment.message_id == msg.id)
            ).all()
            token = jwt.encode(
                {"type": "unsubscribe", "org": msg.organization_id, "email": msg.recipient_email},
                s.jwt_secret,
                algorithm="HS256",
            )
            response = send(
                msg, campaign, account, docs, f"{s.public_url}/api/v1/unsubscribe?token={token}"
            )
            msg.status = "smtp_accepted"
            msg.smtp_response = response
            msg.sent_at = now()
            msg.error = None
            attempt.status = "smtp_accepted"
            attempt.response = response
        except (smtplib.SMTPResponseException, smtplib.SMTPRecipientsRefused) as error:
            code = getattr(error, "smtp_code", 550)
            transient = 400 <= code < 500
            msg.error = str(error)[:2000]
            if transient and msg.attempts <= s.max_retries:
                msg.status = "queued"
                msg.next_attempt_at = now() + timedelta(seconds=30 * 2 ** (msg.attempts - 1))
            else:
                msg.status = "failed"
            attempt.status = "failed"
            attempt.response = msg.error
        except (TimeoutError, ConnectionError, smtplib.SMTPServerDisconnected, OSError) as error:
            msg.status = "uncertain"
            msg.error = "SMTP outcome uncertain; automatic retry withheld: " + str(error)[:1000]
            attempt.status = "uncertain"
            attempt.response = msg.error
        except Exception as error:
            logger.exception("Delivery failed before confirmation")
            msg.status = "failed"
            msg.error = type(error).__name__ + ": " + str(error)[:1000]
            attempt.status = "failed"
            attempt.response = msg.error
        msg.lease_until = None
        db.add(
            EmailEvent(
                organization_id=msg.organization_id,
                message_id=msg.id,
                kind=msg.status,
                details={"attempt": msg.attempts},
            )
        )
        db.commit()
        finish(db, campaign)


def finish(db, campaign):
    db.refresh(campaign)
    if campaign.status not in ("processing", "sending"):
        return
    counts = dict(
        db.execute(
            select(EmailMessage.status, func.count())
            .where(EmailMessage.campaign_id == campaign.id)
            .group_by(EmailMessage.status)
        ).all()
    )
    if not counts.get("queued") and not counts.get("sending"):
        success = sum(counts.get(k, 0) for k in ("smtp_accepted", "delivered", "opened", "clicked"))
        failed = sum(counts.get(k, 0) for k in ("failed", "uncertain", "cancelled", "bounced"))
        campaign.status = (
            "partially_completed" if success and failed else ("completed" if success else "failed")
        )
        campaign.completed_at = now()
        db.commit()


@celery.task(soft_time_limit=240, time_limit=270)
def extract_document(extraction_id):
    from app.agents.orchestrator import execute

    with SessionLocal() as db:
        extraction = db.get(Extraction, extraction_id)
        if not extraction or extraction.status == "completed":
            return
        doc = db.get(Document, extraction.document_id)
        extraction.status = "processing"
        db.commit()
        try:
            result = execute(db, doc.organization_id, "document", {"document_id": doc.id})
            extraction.records = result["records"]
            extraction.duplicates = result["duplicates"]
            extraction.status = "completed"
        except Exception as error:
            extraction.status = "failed"
            extraction.error = str(error)[:1000]
        db.commit()
