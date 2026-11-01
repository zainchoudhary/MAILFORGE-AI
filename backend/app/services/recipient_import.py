"""Atomic batch import; database uniqueness also protects overlapping retries."""
from sqlalchemy.dialects.postgresql import insert
from app.models.entities import Recipient
from app.repositories.common import audit


def import_batch(db, user, recipients):
    # Deterministic order reduces deadlock risk for concurrent overlapping batches.
    unique = {}
    for record in recipients:
        unique.setdefault(record.email, record.model_dump())
    values = [dict(organization_id=user.organization_id, **unique[email]) for email in sorted(unique)]
    statement = insert(Recipient).values(values)
    # Active contacts are preserved. Legacy soft-deleted contacts are restored.
    statement = statement.on_conflict_do_update(
        index_elements=[Recipient.organization_id, Recipient.email],
        set_={**{key: getattr(statement.excluded, key) for key in ('name', 'company', 'position', 'custom_fields')}, 'deleted': False},
        where=Recipient.deleted.is_(True),
    ).returning(Recipient.id)
    try:
        saved = len(db.scalars(statement).all())
        result = {'added': saved, 'duplicates': len(recipients) - saved, 'total': len(recipients)}
        audit(db, user, 'recipients.imported', details=result)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
