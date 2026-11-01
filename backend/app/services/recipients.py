"""Transactional contact deletion; message history retains its existing snapshots."""
from fastapi import HTTPException
from sqlalchemy import select, delete, update, case
from app.models.entities import (
    Recipient, Campaign, CampaignRecipient, EmailMessage, EmailEvent, Consent, GroupMember,
)
from app.repositories.common import audit


def permanently_delete(db, user, identifiers):
    ids = sorted(set(identifiers))
    # Lock only the requested contacts. Earlier code locked every campaign in
    # the account, which made an otherwise small delete unnecessarily slow.
    contacts = list(db.scalars(select(Recipient).where(
        Recipient.organization_id == user.organization_id, Recipient.id.in_(ids),
    ).order_by(Recipient.id).with_for_update()))
    if len(contacts) != len(ids):
        raise HTTPException(404, 'One or more recipients were not found')
    sending = db.scalar(select(EmailMessage.id).where(
        EmailMessage.organization_id == user.organization_id, EmailMessage.recipient_id.in_(ids),
        EmailMessage.status == 'sending',
    ).with_for_update().limit(1))
    if sending:
        raise HTTPException(409, 'A message is currently sending to this recipient. Retry after it finishes.')
    affected = list(db.scalars(select(CampaignRecipient.campaign_id).where(
        CampaignRecipient.organization_id == user.organization_id,
        CampaignRecipient.recipient_id.in_(ids),
    )))
    if affected:
        db.execute(update(Campaign).where(Campaign.id.in_(affected)).values(
            revision=Campaign.revision + 1,
            reviewed_revision=None,
            dry_run_revision=None,
        ))
    queued_ids = list(db.scalars(select(EmailMessage.id).where(
        EmailMessage.organization_id == user.organization_id,
        EmailMessage.recipient_id.in_(ids),
        EmailMessage.status == 'queued',
    )))
    if queued_ids:
        db.add_all([EmailEvent(organization_id=user.organization_id, message_id=identifier, kind='cancelled') for identifier in queued_ids])
    db.execute(update(EmailMessage).where(
        EmailMessage.organization_id == user.organization_id,
        EmailMessage.recipient_id.in_(ids),
    ).values(
        recipient_id=None,
        status=case((EmailMessage.status == 'queued', 'cancelled'), else_=EmailMessage.status),
        error=case((EmailMessage.status == 'queued', 'Recipient permanently deleted'), else_=EmailMessage.error),
    ))
    for model in (CampaignRecipient, GroupMember, Consent):
        db.execute(delete(model).where(model.organization_id == user.organization_id, model.recipient_id.in_(ids)))
    db.execute(delete(Recipient).where(Recipient.organization_id == user.organization_id, Recipient.id.in_(ids)))
    for identifier in ids:
        audit(db, user, 'recipient.deleted', identifier, {'permanent': True})
    db.commit()
    return {'ok': True, 'deleted': len(ids)}
