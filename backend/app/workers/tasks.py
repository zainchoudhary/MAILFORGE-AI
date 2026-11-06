import logging
import smtplib
from collections import defaultdict
from datetime import timedelta
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
DELIVERY_ENQUEUE_TTL_SECONDS = 300
DISPATCH_LOCK_TTL_SECONDS = 30


def delivery_enqueue_key(identifier):
    return f"delivery-enqueued:{identifier}"


def delivery_enqueue_limiter():
    return Redis.from_url(get_settings().redis_url)


def claim_dispatch_lock():
    return delivery_enqueue_limiter().set(
        "delivery-dispatch-lock",
        "running",
        nx=True,
        ex=DISPATCH_LOCK_TTL_SECONDS,
    )


def release_dispatch_lock():
    delivery_enqueue_limiter().delete("delivery-dispatch-lock")


def enqueue_deliveries(pending):
    """Queue each delivery once; beat can safely revisit queued DB rows."""
    by_organization = defaultdict(list)
    for identifier, organization_id in pending:
        by_organization[organization_id].append(identifier)
    interval = max(0.0, float(get_settings().delay_between_emails))
    limiter = delivery_enqueue_limiter()
    for identifiers in by_organization.values():
        for position, identifier in enumerate(identifiers):
            if not limiter.set(
                delivery_enqueue_key(identifier),
                "queued",
                nx=True,
                ex=DELIVERY_ENQUEUE_TTL_SECONDS,
            ):
                continue
            deliver.apply_async(
                args=[identifier],
                countdown=(position * interval) if interval else 0,
            )


def queue_campaign_delivery(campaign_id):
    """Kick off one campaign's queued messages without waiting for beat."""
    with SessionLocal() as db:
        pending = db.execute(
            select(EmailMessage.id, EmailMessage.organization_id)
            .where(
                EmailMessage.campaign_id == campaign_id,
                EmailMessage.status == "queued",
                (EmailMessage.next_attempt_at.is_(None)) | (EmailMessage.next_attempt_at <= now()),
            )
            .order_by(EmailMessage.created_at)
        ).all()
    if pending:
        enqueue_deliveries(pending)


@celery.task
def dispatch():
    if not claim_dispatch_lock():
        return
    try:
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
            pending = db.execute(
            select(EmailMessage.id, EmailMessage.organization_id)
            .join(Campaign)
            .where(
                Campaign.status.in_(["processing", "sending"]),
                EmailMessage.status == "queued",
                (EmailMessage.next_attempt_at.is_(None)) | (EmailMessage.next_attempt_at <= now()),
            )
            .order_by(EmailMessage.created_at)
            ).all()
        enqueue_deliveries(pending)
    finally:
        try:
            release_dispatch_lock()
        except Exception:
            logger.exception("Could not release recovery dispatch lock")


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
        # Only the primary address can cancel a queued message. CC/BCC are optional
        # SMTP headers — missing library rows must not cancel the whole send.
        if msg.recipient_id:
            primary = db.get(Recipient, msg.recipient_id)
            if primary is not None and not eligible(db, msg.organization_id, primary):
                msg.status = "cancelled"
                msg.error = "Recipient is no longer available"
                db.commit()
                finish(db, campaign)
                return
        elif not msg.recipient_email:
            msg.status = "cancelled"
            msg.error = "Recipient address is missing"
            db.commit()
            finish(db, campaign)
            return
        # Soft per-org spacing. If another send just claimed the slot, re-queue
        # quickly instead of waiting for the next beat cycle.
        interval = max(0.0, float(s.delay_between_emails))
        if interval > 0:
            limiter = Redis.from_url(s.redis_url)
            if not limiter.set(
                f"send-rate:{msg.organization_id}",
                identifier,
                nx=True,
                px=max(100, int(interval * 1000)),
            ):
                deliver.apply_async(args=[identifier], countdown=max(interval, 0.2))
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
            # The message is now durably claimed as `sending`; future beat
            # ticks cannot publish a duplicate task for it.
            delivery_enqueue_limiter().delete(delivery_enqueue_key(identifier))
        except Exception:
            # An expired lock is harmless once the durable status is sending.
            logger.exception("Could not release delivery enqueue lease")
        retry_delay = None
        try:
            account = db.get(SMTPAccount, campaign.smtp_account_id)
            docs = db.scalars(
                select(Document)
                .join(Attachment, Attachment.document_id == Document.id)
                .where(Attachment.message_id == msg.id)
            ).all()
            response = send(msg, campaign, account, docs)
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
                retry_delay = 30 * 2 ** (msg.attempts - 1)
                msg.next_attempt_at = now() + timedelta(seconds=retry_delay)
            else:
                msg.status = "failed"
            attempt.status = "failed"
            attempt.response = msg.error
        except (TimeoutError, ConnectionError, smtplib.SMTPServerDisconnected, OSError) as error:
            # Prefer a short retry over dropping the recipient. After retries are
            # exhausted, keep uncertain so operators can verify before a manual resend.
            detail = str(error)[:1000]
            if msg.attempts <= s.max_retries:
                msg.status = "queued"
                retry_delay = max(3, 4 * msg.attempts)
                msg.next_attempt_at = now() + timedelta(seconds=retry_delay)
                msg.error = "Temporary SMTP connection issue; retrying: " + detail
                attempt.status = "failed"
                attempt.response = msg.error
            else:
                msg.status = "uncertain"
                msg.error = "SMTP outcome uncertain after retries; verify with provider before any manual resend: " + detail
                attempt.status = "uncertain"
                attempt.response = msg.error
        except Exception as error:
            logger.exception("Delivery failed before confirmation")
            detail = type(error).__name__ + ": " + str(error)[:1000]
            if msg.attempts <= s.max_retries:
                msg.status = "queued"
                retry_delay = max(3, 4 * msg.attempts)
                msg.next_attempt_at = now() + timedelta(seconds=retry_delay)
                msg.error = "Temporary delivery issue; retrying: " + detail
                attempt.status = "failed"
                attempt.response = msg.error
            else:
                msg.status = "failed"
                msg.error = detail
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
        if retry_delay:
            try:
                # Schedule the retry directly so temporary delivery recovery
                # does not depend solely on the periodic dispatcher.
                deliver.apply_async(args=[identifier], countdown=retry_delay)
            except Exception:
                # The dispatcher remains a safe recovery path if the broker
                # briefly rejects a scheduling request after the DB commit.
                logger.exception("Could not schedule SMTP retry; dispatcher will recover it")
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


@celery.task(soft_time_limit=540, time_limit=600)
def run_lead_finder_batch(run_id, batch_limit=20, generation=None):
    from app.lead_finder.pipeline import run_lead_batch
    from app.lead_finder.service import candidate_count, schedule_next_batch_if_needed

    with SessionLocal() as db:
        kept_before = candidate_count(db, run_id)
        summary = run_lead_batch(db, run_id, batch_limit=batch_limit, generation=generation)
    # Keep searching in further Celery jobs until target_count or search stalls.
    schedule_next_batch_if_needed(run_id, kept_before, generation)
    return summary
