from datetime import timedelta
from sqlalchemy import select, func
from app.models.entities import Campaign, Recipient, EmailMessage, EmailEvent, now


def overview(db, org):
    counts = dict(
        db.execute(
            select(EmailMessage.status, func.count())
            .where(EmailMessage.organization_id == org)
            .group_by(EmailMessage.status)
        ).all()
    )
    total = sum(counts.values())
    accepted = sum(counts.get(k, 0) for k in ("smtp_accepted", "delivered", "opened", "clicked"))
    confirmed = db.scalar(
        select(func.count(func.distinct(EmailEvent.message_id))).where(
            EmailEvent.organization_id == org, EmailEvent.kind == "delivered"
        )
    )
    return {
        "campaigns": db.scalar(
            select(func.count()).select_from(Campaign).where(Campaign.organization_id == org)
        ),
        "recipients": db.scalar(
            select(func.count())
            .select_from(Recipient)
            .where(Recipient.organization_id == org, Recipient.deleted.is_(False))
        ),
        "processed": total - counts.get("queued", 0) - counts.get("sending", 0),
        "total": total,
        "smtp_accepted": accepted,
        "confirmed_deliveries": confirmed,
        "failed": counts.get("failed", 0),
        "bounced": counts.get("bounced", 0),
        "pending": counts.get("queued", 0) + counts.get("sending", 0),
        "scheduled": db.scalar(
            select(func.count())
            .select_from(EmailMessage)
            .join(Campaign)
            .where(
                Campaign.organization_id == org,
                Campaign.status == "scheduled",
                EmailMessage.status == "queued",
            )
        ),
        "success_rate": round(100 * accepted / total, 1) if total else 0,
        "failure_rate": round(100 * counts.get("failed", 0) / total, 1) if total else 0,
        "statuses": counts,
    }


def activity(db, org, days=30):
    date = func.date_trunc("day", EmailMessage.created_at)
    rows = db.execute(
        select(date.label("day"), EmailMessage.status, func.count())
        .where(
            EmailMessage.organization_id == org,
            EmailMessage.created_at >= now() - timedelta(days=days),
        )
        .group_by(date, EmailMessage.status)
        .order_by(date)
    ).all()
    grouped = {}
    for day, status, count in rows:
        key = day.date().isoformat()
        grouped.setdefault(key, {"date": key, "total": 0, "accepted": 0, "failed": 0})
        grouped[key]["total"] += count
        if status in ("smtp_accepted", "delivered", "opened", "clicked"):
            grouped[key]["accepted"] += count
        if status == "failed":
            grouped[key]["failed"] += count
    return list(grouped.values())


def campaigns(db, org):
    rows = (
        db.execute(
            select(
                Campaign.id,
                Campaign.name,
                Campaign.status,
                func.count(EmailMessage.id).label("total"),
            )
            .outerjoin(EmailMessage)
            .where(Campaign.organization_id == org)
            .group_by(Campaign.id)
            .order_by(Campaign.created_at.desc())
            .limit(100)
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]
