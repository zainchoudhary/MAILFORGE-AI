from fastapi import HTTPException
from sqlalchemy import select, delete, func
from app.models.entities import (
    Campaign,
    CampaignRecipient,
    Recipient,
    Attachment,
    Document,
    SMTPAccount,
    Template,
    Consent,
    Suppression,
    EmailMessage,
    EmailEvent,
    ScheduledCampaign,
    now,
)
from app.repositories.common import owned, audit, serialize
from app.core.config import get_settings
from app.email_engine.render import personalize

EDITABLE = {"draft", "cancelled"}


def save(db, user, data, campaign=None):
    s = get_settings()
    if campaign:
        campaign = db.scalar(
            select(Campaign)
            .where(Campaign.id == campaign.id, Campaign.organization_id == user.organization_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ids = list(dict.fromkeys(data.recipient_ids))
    if len(ids) > s.max_emails_per_run:
        raise HTTPException(422, f"Maximum {s.max_emails_per_run} recipients per campaign")
    if len(ids) > 1 and (data.cc or data.bcc):
        raise HTTPException(422, "CC/BCC are available for single-recipient campaigns only")
    if data.scheduled_at and data.scheduled_at <= now():
        raise HTTPException(422, "Schedule must be in the future")
    for identifier in ids:
        recipient = owned(db, Recipient, identifier, user.organization_id)
        if recipient.deleted:
            raise HTTPException(422, "Recipient has been removed")
    for identifier in data.recipient_templates.values():
        owned(db, Template, identifier, user.organization_id)
    if set(data.recipient_templates) - set(ids):
        raise HTTPException(422, "Template assignment refers to an unselected recipient")
    docs = [owned(db, Document, i, user.organization_id) for i in set(data.attachment_ids)]
    if sum(d.size for d in docs) > s.max_attachment_bytes:
        raise HTTPException(422, "Combined attachments exceed size limit")
    if data.smtp_account_id:
        owned(db, SMTPAccount, data.smtp_account_id, user.organization_id)
    values = data.model_dump(exclude={"recipient_ids", "attachment_ids", "recipient_templates"})
    if campaign:
        if campaign.status not in EDITABLE:
            raise HTTPException(409, "Only draft or cancelled campaigns can be edited")
        if db.scalar(
            select(func.count())
            .select_from(EmailMessage)
            .where(EmailMessage.campaign_id == campaign.id)
        ):
            raise HTTPException(409, "Duplicate this campaign to edit after delivery was prepared")
        for key, value in values.items():
            setattr(campaign, key, value)
        campaign.revision += 1
        campaign.status = "draft"
        campaign.approved_at = None
        db.execute(delete(CampaignRecipient).where(CampaignRecipient.campaign_id == campaign.id))
        db.execute(
            delete(Attachment).where(
                Attachment.campaign_id == campaign.id, Attachment.message_id.is_(None)
            )
        )
    else:
        campaign = Campaign(organization_id=user.organization_id, **values)
        db.add(campaign)
        db.flush()
    for identifier in ids:
        db.add(
            CampaignRecipient(
                organization_id=user.organization_id,
                campaign_id=campaign.id,
                recipient_id=identifier,
                template_id=data.recipient_templates.get(identifier),
            )
        )
    for doc in docs:
        db.add(
            Attachment(
                organization_id=user.organization_id, campaign_id=campaign.id, document_id=doc.id
            )
        )
    audit(db, user, "campaign.saved", campaign.id, {"revision": campaign.revision})
    db.commit()
    return campaign


def detail(db, campaign):
    result = serialize(campaign)
    links = db.scalars(
        select(CampaignRecipient).where(CampaignRecipient.campaign_id == campaign.id)
    ).all()
    result["recipients"] = [
        {**serialize(db.get(Recipient, link.recipient_id)), "template_id": link.template_id}
        for link in links
    ]
    docs = db.scalars(
        select(Document)
        .join(Attachment, Attachment.document_id == Document.id)
        .where(Attachment.campaign_id == campaign.id, Attachment.message_id.is_(None))
    ).all()
    result["attachments"] = [serialize(d, ("storage_key",)) for d in docs]
    result["counts"] = dict(
        db.execute(
            select(EmailMessage.status, func.count())
            .where(EmailMessage.campaign_id == campaign.id)
            .group_by(EmailMessage.status)
        ).all()
    )
    return result


def eligible(db, org, recipient):
    if recipient.deleted:
        return False
    if db.scalar(
        select(Suppression.id).where(
            Suppression.organization_id == org, Suppression.email == recipient.email
        )
    ):
        return False
    consent = db.scalar(
        select(Consent)
        .where(Consent.organization_id == org, Consent.recipient_id == recipient.id)
        .order_by(Consent.created_at.desc())
        .limit(1)
    )
    return bool(consent and consent.granted)


def preview(db, campaign):
    links = db.scalars(
        select(CampaignRecipient).where(CampaignRecipient.campaign_id == campaign.id)
    ).all()
    output = []
    for link in links:
        recipient = db.get(Recipient, link.recipient_id)
        template = db.get(Template, link.template_id) if link.template_id else campaign
        try:
            subject = personalize(template.subject, recipient)
            body = personalize(template.body, recipient, escape=True)
        except ValueError as error:
            raise HTTPException(422, str(error))
        output.append(
            {
                "recipient_id": recipient.id,
                "email": recipient.email,
                "name": recipient.name,
                "subject": subject,
                "body": body,
                "eligible": eligible(db, campaign.organization_id, recipient),
            }
        )
    return output


def approve(db, user, campaign, data):
    # Row lock serializes concurrent approvals before unique message keys are inserted.
    campaign = db.scalar(
        select(Campaign)
        .where(Campaign.id == campaign.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if campaign.status != "draft" or campaign.revision != data.revision:
        raise HTTPException(409, "Campaign changed or is no longer a draft")
    if (
        campaign.dry_run_revision != campaign.revision
        or campaign.reviewed_revision != campaign.revision
    ):
        raise HTTPException(
            409, "Review recipients and complete a dry run for the current revision first"
        )
    if get_settings().dry_run:
        raise HTTPException(409, "Server DRY_RUN is enabled. No production email will be sent")
    if not campaign.smtp_account_id:
        raise HTTPException(422, "Select a tested SMTP account")
    account = owned(db, SMTPAccount, campaign.smtp_account_id, user.organization_id)
    if not account.tested_at:
        raise HTTPException(422, "Test SMTP connection first")
    previews = preview(db, campaign)
    if not previews or any(not p["eligible"] for p in previews):
        raise HTTPException(
            422, "Every selected recipient needs consent and must not be suppressed"
        )
    # CC/BCC also require independently recorded consent and suppression checks.
    for email in [*campaign.cc, *campaign.bcc]:
        recipient = db.scalar(
            select(Recipient).where(
                Recipient.organization_id == user.organization_id, Recipient.email == email.lower()
            )
        )
        if not recipient or not eligible(db, user.organization_id, recipient):
            raise HTTPException(422, "CC/BCC recipients must have consent and not be suppressed")
    for item in previews:
        msg = EmailMessage(
            organization_id=user.organization_id,
            campaign_id=campaign.id,
            recipient_id=item["recipient_id"],
            recipient_email=item["email"],
            recipient_name=item["name"],
            subject=item["subject"],
            body=item["body"],
            idempotency_key=f"{campaign.id}:{item['recipient_id']}:{campaign.revision}",
        )
        db.add(msg)
        db.flush()
        attachments = db.scalars(
            select(Attachment).where(
                Attachment.campaign_id == campaign.id, Attachment.message_id.is_(None)
            )
        ).all()
        link = db.scalar(
            select(CampaignRecipient).where(
                CampaignRecipient.campaign_id == campaign.id,
                CampaignRecipient.recipient_id == item["recipient_id"],
            )
        )
        if link.template_id:
            attachments += list(
                db.scalars(select(Attachment).where(Attachment.template_id == link.template_id))
            )
        doc_ids = set(a.document_id for a in attachments)
        if sum(db.get(Document, i).size for i in doc_ids) > get_settings().max_attachment_bytes:
            raise HTTPException(422, "Combined campaign and template attachments exceed the limit")
        for identifier in doc_ids:
            db.add(
                Attachment(
                    organization_id=user.organization_id, message_id=msg.id, document_id=identifier
                )
            )
        db.add(EmailEvent(organization_id=user.organization_id, message_id=msg.id, kind="queued"))
    campaign.approved_at = now()
    if campaign.scheduled_at and campaign.scheduled_at > now():
        campaign.status = "scheduled"
        db.add(
            ScheduledCampaign(
                organization_id=user.organization_id,
                campaign_id=campaign.id,
                due_at=campaign.scheduled_at,
            )
        )
    else:
        campaign.status = "processing"
    audit(
        db,
        user,
        "campaign.approved",
        campaign.id,
        {"revision": campaign.revision, "recipient_count": len(previews)},
    )
    db.commit()
    # Periodic dispatcher discovers committed rows; broker failures cannot lose campaigns.
    return campaign
