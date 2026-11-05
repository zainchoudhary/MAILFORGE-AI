from fastapi import HTTPException
from sqlalchemy import select, func
from app.models.entities import AuditLog


def owned(db, model, identifier, org):
    record = db.scalar(select(model).where(model.id == identifier, model.organization_id == org))
    if record is None:
        raise HTTPException(404, "Record not found")
    return record


def serialize(record, exclude=()):
    return {
        c.name: getattr(record, c.name) for c in record.__table__.columns if c.name not in exclude
    }


def page(db, model, org, page=1, limit=25, conditions=(), order=None):
    query = select(model).where(model.organization_id == org, *conditions)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    if order is None:
        query = query.order_by(model.created_at.desc())
    elif isinstance(order, (tuple, list)):
        query = query.order_by(*order)
    else:
        query = query.order_by(order)
    records = db.scalars(query.offset((page - 1) * limit).limit(limit)).all()
    return {"items": [serialize(r) for r in records], "total": total, "page": page, "limit": limit}


def audit(db, user, action, resource=None, details=None):
    db.add(
        AuditLog(
            organization_id=user.organization_id,
            user_id=user.id,
            action=action,
            resource_id=resource,
            details=details or {},
        )
    )
