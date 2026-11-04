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
    recipient_ids = [link.recipient_id for link in links]
    recipients = {
        recipient.id: recipient
        for recipient in db.scalars(
            select(Recipient).where(
                Recipient.organization_id == campaign.organization_id,
                Recipient.id.in_(recipient_ids),
            )
        )
    } if recipient_ids else {}
    result["recipients"] = [
        {**serialize(recipients[link.recipient_id]), "template_id": link.template_id}
        for link in links
        if link.recipient_id in recipients
    ]
    # Campaign history must remain understandable after a contact is removed
    # from the live recipient library. EmailMessage stores the name/address
    # snapshot used at delivery, so include it when its original link no longer
    # exists (for example after a permanent recipient deletion).
    known_addresses = {item["email"].lower() for item in result["recipients"]}
    for message in db.scalars(
        select(EmailMessage)
        .where(EmailMessage.campaign_id == campaign.id)
        .order_by(EmailMessage.created_at)
    ):
        address = message.recipient_email.lower()
        if address in known_addresses:
            continue
        known_addresses.add(address)
        result["recipients"].append({
            "id": message.recipient_id or f"delivery-{message.id}",
            "email": message.recipient_email,
            "name": message.recipient_name,
            "company": "",
            "position": "",
            "template_id": None,
            "historical": True,
            "delivery_status": message.status,
        })
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
    # Recipient delivery is controlled by the saved recipient record and SMTP
    # provider response only. Legacy suppression entries no longer block sends.
    return not recipient.deleted


def preview(db, campaign):
    links = db.scalars(
        select(CampaignRecipient).where(CampaignRecipient.campaign_id == campaign.id)
    ).all()
    if not links:
        return []
    recipients = {r.id: r for r in db.scalars(select(Recipient).where(
        Recipient.organization_id == campaign.organization_id,
        Recipient.id.in_([link.recipient_id for link in links]),
    ))}
    templates = {t.id: t for t in db.scalars(select(Template).where(
        Template.organization_id == campaign.organization_id,
        Template.id.in_([link.template_id for link in links if link.template_id]),
    ))}
    output = []
    for link in links:
        recipient = recipients.get(link.recipient_id)
        template = templates.get(link.template_id) if link.template_id else campaign
        if recipient is None or template is None:
            raise HTTPException(422, "A campaign recipient or template is unavailable")
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
                # Saved recipients are active unless the contact itself was removed.
                "eligible": not recipient.deleted,
                "suppressed": False,
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
    if get_settings().dry_run:
        raise HTTPException(409, "Server DRY_RUN is enabled. No production email will be sent")
    if not campaign.smtp_account_id:
        raise HTTPException(422, "Select a tested SMTP account")
    account = owned(db, SMTPAccount, campaign.smtp_account_id, user.organization_id)
    if not account.tested_at:
        raise HTTPException(422, "Test SMTP connection first")
    previews = preview(db, campaign)
    if not previews:
        raise HTTPException(422, "Select at least one recipient")
    # One-click send: complete review + dry-run preflight in this same request.
    campaign.reviewed_revision = campaign.revision
    campaign.dry_run_revision = campaign.revision
    # Saved recipients are active by default. Soft-deleted contacts cannot be selected.
    for email in [*campaign.cc, *campaign.bcc]:
        recipient = db.scalar(
            select(Recipient).where(
                Recipient.organization_id == user.organization_id, Recipient.email == email.lower()
            )
        )
        if not recipient or recipient.deleted:
            raise HTTPException(422, "CC/BCC recipients must exist in your library")
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
