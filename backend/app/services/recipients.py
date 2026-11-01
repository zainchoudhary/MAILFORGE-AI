"""Transactional contact deletion; message history retains its existing snapshots."""
from fastapi import HTTPException
from sqlalchemy import select, delete
from app.models.entities import (
    Recipient, Campaign, CampaignRecipient, EmailMessage, EmailEvent, Consent, GroupMember,
)
from app.repositories.common import audit


def permanently_delete(db, user, identifiers):
    ids = sorted(set(identifiers))
    # Same lock order as delivery/approval: campaigns, then messages/contacts.
    campaigns = list(db.scalars(select(Campaign).where(
        Campaign.organization_id == user.organization_id,
    ).order_by(Campaign.id).with_for_update()))
    contacts = list(db.scalars(select(Recipient).where(
        Recipient.organization_id == user.organization_id, Recipient.id.in_(ids),
    ).order_by(Recipient.id).with_for_update()))
    if len(contacts) != len(ids):
        raise HTTPException(404, 'One or more recipients were not found')
    messages = list(db.scalars(select(EmailMessage).where(
        EmailMessage.organization_id == user.organization_id, EmailMessage.recipient_id.in_(ids),
    ).with_for_update()))
    if any(message.status == 'sending' for message in messages):
        raise HTTPException(409, 'A message is currently sending to this recipient. Retry after it finishes.')
    links = list(db.scalars(select(CampaignRecipient).where(
        CampaignRecipient.organization_id == user.organization_id,
        CampaignRecipient.recipient_id.in_(ids),
    )))
    affected = {link.campaign_id for link in links}
    for campaign in campaigns:
        if campaign.id in affected:
            campaign.revision += 1
            campaign.reviewed_revision = None
            campaign.dry_run_revision = None
    for message in messages:
        if message.status == 'queued':
            message.status = 'cancelled'
            message.error = 'Recipient permanently deleted'
            db.add(EmailEvent(organization_id=user.organization_id, message_id=message.id, kind='cancelled'))
        message.recipient_id = None
    db.flush()
    for model in (CampaignRecipient, GroupMember, Consent):
        db.execute(delete(model).where(model.organization_id == user.organization_id, model.recipient_id.in_(ids)))
    db.execute(delete(Recipient).where(Recipient.organization_id == user.organization_id, Recipient.id.in_(ids)))
    for identifier in ids:
        audit(db, user, 'recipient.deleted', identifier, {'permanent': True})
    db.commit()
    return {'ok': True, 'deleted': len(ids)}
