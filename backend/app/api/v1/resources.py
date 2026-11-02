from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, delete, update, func
from app.database.session import get_db
from app.security.auth import current_user, editor, admin, encrypt
from app.models.entities import (
    Document,
    Extraction,
    Recipient,
    RecipientGroup,
    GroupMember,
    Consent,
    Suppression,
    Template,
    Attachment,
    SMTPAccount,
    UserSettings,
    AuditLog,
    Notification,
    AgentExecution,
    AgentLog,
    now,
)
from app.schemas.inputs import (
    RecipientInput,
    BulkRecipientDelete,
    BulkRecipientImport,
    RecipientGroupInput,
    ConsentInput,
    TemplateInput,
    SMTPInput,
    SuppressionInput,
)
from app.repositories.common import owned, serialize, page, audit
from app.core.config import get_settings
from app.services.storage import upload

router = APIRouter()


@router.post("/documents/upload", tags=["Documents"], status_code=201)
async def upload_document(file: UploadFile = File(...), user=Depends(editor), db=Depends(get_db)):
    doc = await upload(db, user, file)
    audit(db, user, "document.uploaded", doc.id, {"filename": doc.filename})
    db.commit()
    return serialize(doc, ("storage_key",))


@router.get("/documents", tags=["Documents"])
def documents(
    page_number: int = Query(1, ge=1, alias="page"),
    limit: int = Query(25, ge=1, le=100),
    user=Depends(current_user),
    db=Depends(get_db),
):
    result = page(db, Document, user.organization_id, page_number, limit)
    for item in result["items"]:
        item.pop("storage_key", None)
    return result


@router.get("/documents/{identifier}", tags=["Documents"])
def document(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    return serialize(owned(db, Document, identifier, user.organization_id), ("storage_key",))


@router.get("/documents/{identifier}/download", tags=["Documents"])
def download(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    doc = owned(db, Document, identifier, user.organization_id)
    return FileResponse(
        Path(get_settings().storage_path) / doc.storage_key,
        media_type=doc.mime_type,
        filename=doc.filename,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.post("/documents/{identifier}/extract", tags=["Documents"], status_code=202)
def extract(
    identifier: str,
    user=Depends(editor),
    db=Depends(get_db),
):
    from app.workers.tasks import extract_document

    doc = owned(db, Document, identifier, user.organization_id)
    item = Extraction(organization_id=user.organization_id, document_id=doc.id)
    db.add(item)
    db.commit()
    # API-only mode is the default local setup. Run extraction in the same
    # request so the caller receives the finished records immediately.
    if not get_settings().redis_url:
        extract_document.run(item.id)
        db.expire_all()
        return serialize(db.get(Extraction, item.id))
    try:
        extract_document.delay(item.id)
    except Exception:
        # Local/API-only development must not lose extraction work just because
        # the optional Celery broker is unavailable. Celery's .run() executes
        # the exact same task logic using a FastAPI background task.
        extract_document.run(item.id)
        db.expire_all()
        return serialize(db.get(Extraction, item.id))
    return serialize(item)


@router.get("/documents/{identifier}/recipients", tags=["Documents"])
def extracted(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    owned(db, Document, identifier, user.organization_id)
    item = db.scalar(
        select(Extraction)
        .where(Extraction.document_id == identifier)
        .order_by(Extraction.created_at.desc())
        .limit(1)
    )
    return serialize(item) if item else {"status": "not_started", "records": [], "duplicates": 0}


@router.get("/recipients", tags=["Recipients"])
def recipients(
    q: str = "",
    page_number: int = Query(1, ge=1, alias="page"),
    limit: int = Query(25, ge=1, le=100),
    user=Depends(current_user),
    db=Depends(get_db),
):
    conditions = [Recipient.deleted.is_(False)]
    if q:
        conditions.append(Recipient.email.ilike(f"%{q}%") | Recipient.name.ilike(f"%{q}%"))
    result = page(db, Recipient, user.organization_id, page_number, limit, conditions)
    # Fetch consent history for the whole page in one query. The previous
    # per-recipient lookup caused one remote Neon round-trip per row.
    recipient_ids = [row["id"] for row in result["items"]]
    latest_consent = {}
    if recipient_ids:
        for consent in db.scalars(
            select(Consent)
            .where(
                Consent.organization_id == user.organization_id,
                Consent.recipient_id.in_(recipient_ids),
            )
            .order_by(Consent.created_at.desc())
        ):
            latest_consent.setdefault(consent.recipient_id, consent)
    for row in result["items"]:
        consent = latest_consent.get(row["id"])
        row["consent"] = bool(consent and consent.granted)
    return result


def group_payloads(db, organization_id):
    """Return groups and saved members without one query per group."""
    groups = list(db.scalars(
        select(RecipientGroup)
        .where(RecipientGroup.organization_id == organization_id)
        .order_by(RecipientGroup.created_at.desc())
    ))
    if not groups:
        return []
    member_ids = {group.id: [] for group in groups}
    for group_id, recipient_id in db.execute(
        select(GroupMember.group_id, GroupMember.recipient_id).where(
            GroupMember.organization_id == organization_id,
            GroupMember.group_id.in_(member_ids),
        )
    ):
        member_ids[group_id].append(recipient_id)
    return [
        {**serialize(group), "recipient_ids": member_ids[group.id], "recipient_count": len(member_ids[group.id])}
        for group in groups
    ]


def validate_group_members(db, user, identifiers):
    recipient_ids = list(dict.fromkeys(identifiers))
    found = set(db.scalars(
        select(Recipient.id).where(
            Recipient.organization_id == user.organization_id,
            Recipient.deleted.is_(False),
            Recipient.id.in_(recipient_ids),
        )
    ))
    if len(found) != len(recipient_ids):
        raise HTTPException(422, "One or more selected recipients are unavailable in this account")
    return recipient_ids


@router.get("/recipient-groups", tags=["Recipient groups"])
def recipient_groups(user=Depends(current_user), db=Depends(get_db)):
    return {"items": group_payloads(db, user.organization_id)}


@router.post("/recipient-groups", tags=["Recipient groups"], status_code=201)
def create_recipient_group(data: RecipientGroupInput, user=Depends(editor), db=Depends(get_db)):
    duplicate = db.scalar(select(RecipientGroup.id).where(
        RecipientGroup.organization_id == user.organization_id,
        RecipientGroup.name == data.name,
    ))
    if duplicate:
        raise HTTPException(409, "A recipient group with this name already exists")
    recipient_ids = validate_group_members(db, user, data.recipient_ids)
    group = RecipientGroup(organization_id=user.organization_id, name=data.name)
    db.add(group)
    db.flush()
    db.add_all([
        GroupMember(organization_id=user.organization_id, group_id=group.id, recipient_id=recipient_id)
        for recipient_id in recipient_ids
    ])
    audit(db, user, "recipient_group.created", group.id, {"members": len(recipient_ids)})
    db.commit()
    return {**serialize(group), "recipient_ids": recipient_ids, "recipient_count": len(recipient_ids)}


@router.put("/recipient-groups/{identifier}", tags=["Recipient groups"])
def update_recipient_group(identifier: str, data: RecipientGroupInput, user=Depends(editor), db=Depends(get_db)):
    group = owned(db, RecipientGroup, identifier, user.organization_id)
    duplicate = db.scalar(select(RecipientGroup.id).where(
        RecipientGroup.organization_id == user.organization_id,
        RecipientGroup.name == data.name,
        RecipientGroup.id != group.id,
    ))
    if duplicate:
        raise HTTPException(409, "A recipient group with this name already exists")
    recipient_ids = validate_group_members(db, user, data.recipient_ids)
    group.name = data.name
    db.execute(delete(GroupMember).where(
        GroupMember.organization_id == user.organization_id,
        GroupMember.group_id == group.id,
    ))
    db.add_all([
        GroupMember(organization_id=user.organization_id, group_id=group.id, recipient_id=recipient_id)
        for recipient_id in recipient_ids
    ])
    audit(db, user, "recipient_group.updated", group.id, {"members": len(recipient_ids)})
    db.commit()
    return {**serialize(group), "recipient_ids": recipient_ids, "recipient_count": len(recipient_ids)}


@router.delete("/recipient-groups/{identifier}", tags=["Recipient groups"])
def delete_recipient_group(identifier: str, user=Depends(editor), db=Depends(get_db)):
    group = owned(db, RecipientGroup, identifier, user.organization_id)
    db.execute(delete(GroupMember).where(
        GroupMember.organization_id == user.organization_id,
        GroupMember.group_id == group.id,
    ))
    db.delete(group)
    audit(db, user, "recipient_group.deleted", group.id)
    db.commit()
    return {"ok": True}


@router.post("/recipients/import", tags=["Recipients"])
def import_recipients(data: BulkRecipientImport, user=Depends(editor), db=Depends(get_db)):
    from app.services.recipient_import import import_batch
    return import_batch(db, user, data.recipients)


@router.post("/recipients", tags=["Recipients"], status_code=201)
def add_recipient(data: RecipientInput, user=Depends(editor), db=Depends(get_db)):
    item = db.scalar(
        select(Recipient).where(
            Recipient.organization_id == user.organization_id, Recipient.email == data.email
        )
    )
    if item and not item.deleted:
        raise HTTPException(409, "Recipient already exists")
    if item:
        for key, value in data.model_dump().items():
            setattr(item, key, value)
        item.deleted = False
    else:
        item = Recipient(organization_id=user.organization_id, **data.model_dump())
        db.add(item)
    db.flush()
    audit(db, user, "recipient.saved", item.id)
    db.commit()
    return serialize(item)


@router.put("/recipients/{identifier}", tags=["Recipients"])
def update_recipient(
    identifier: str, data: RecipientInput, user=Depends(editor), db=Depends(get_db)
):
    item = owned(db, Recipient, identifier, user.organization_id)
    if item.email != data.email:
        raise HTTPException(
            422,
            "Create a new recipient to change an address; consent cannot transfer to another address",
        )
    for key, value in data.model_dump().items():
        setattr(item, key, value)
    from app.models.entities import Campaign, CampaignRecipient

    for campaign in db.scalars(
        select(Campaign)
        .join(CampaignRecipient)
        .where(CampaignRecipient.recipient_id == item.id, Campaign.status == "draft")
    ).unique():
        campaign.revision += 1
    audit(db, user, "recipient.updated", item.id)
    db.commit()
    return serialize(item)


@router.delete("/recipients/{identifier}", tags=["Recipients"])
def delete_recipient(identifier: str, user=Depends(editor), db=Depends(get_db)):
    from app.services.recipients import permanently_delete
    return permanently_delete(db, user, [identifier])


@router.post("/recipients/bulk-delete", tags=["Recipients"])
def bulk_delete_recipients(
    data: BulkRecipientDelete, user=Depends(editor), db=Depends(get_db)
):
    from app.services.recipients import permanently_delete
    return permanently_delete(db, user, data.recipient_ids)


@router.delete("/documents/{identifier}", tags=["Documents"])
def delete_document(identifier: str, user=Depends(editor), db=Depends(get_db)):
    doc = owned(db, Document, identifier, user.organization_id)
    path = Path(get_settings().storage_path) / doc.storage_key
    db.execute(delete(Attachment).where(Attachment.document_id == doc.id))
    db.execute(delete(Extraction).where(Extraction.document_id == doc.id))
    db.delete(doc)
    audit(db, user, "document.deleted", identifier)
    db.commit()
    path.unlink(missing_ok=True)
    return {"ok": True}


@router.post("/recipients/{identifier}/consent", tags=["Recipients"])
def consent(identifier: str, data: ConsentInput, user=Depends(editor), db=Depends(get_db)):
    owned(db, Recipient, identifier, user.organization_id)
    db.add(
        Consent(organization_id=user.organization_id, recipient_id=identifier, **data.model_dump())
    )
    audit(db, user, "recipient.consent", identifier, data.model_dump())
    db.commit()
    return {"ok": True}


@router.get("/suppressions", tags=["Recipients"])
def suppressions(user=Depends(current_user), db=Depends(get_db)):
    return page(db, Suppression, user.organization_id, limit=100)


@router.post("/suppressions", tags=["Recipients"])
def suppress(data: SuppressionInput, user=Depends(editor), db=Depends(get_db)):
    email = str(data.email).lower()
    item = db.scalar(
        select(Suppression).where(
            Suppression.organization_id == user.organization_id, Suppression.email == email
        )
    )
    if not item:
        item = Suppression(organization_id=user.organization_id, email=email, reason=data.reason)
        db.add(item)
    audit(db, user, "recipient.suppressed", details={"email": email, "reason": data.reason})
    db.commit()
    return serialize(item)


@router.delete("/suppressions/{identifier}", tags=["Recipients"])
def delete_suppression(identifier: str, user=Depends(editor), db=Depends(get_db)):
    item = owned(db, Suppression, identifier, user.organization_id)
    db.delete(item)
    audit(db, user, "recipient.unsuppressed", identifier)
    db.commit()
    return {"ok": True}


@router.get("/templates", tags=["Templates"])
def templates(user=Depends(current_user), db=Depends(get_db)):
    return page(db, Template, user.organization_id, limit=100)


@router.post("/templates", tags=["Templates"], status_code=201)
def create_template(data: TemplateInput, user=Depends(editor), db=Depends(get_db)):
    item = Template(organization_id=user.organization_id, **data.model_dump())
    db.add(item)
    db.flush()
    audit(db, user, "template.created", item.id)
    db.commit()
    return serialize(item)


@router.put("/templates/{identifier}", tags=["Templates"])
def update_template(identifier: str, data: TemplateInput, user=Depends(editor), db=Depends(get_db)):
    from app.models.entities import Campaign, CampaignRecipient

    item = owned(db, Template, identifier, user.organization_id)
    for key, value in data.model_dump().items():
        setattr(item, key, value)
    for campaign in db.scalars(
        select(Campaign)
        .join(CampaignRecipient)
        .where(CampaignRecipient.template_id == item.id, Campaign.status == "draft")
    ).unique():
        campaign.revision += 1
    audit(db, user, "template.updated", item.id)
    db.commit()
    return serialize(item)


@router.delete("/templates/{identifier}", tags=["Templates"])
def delete_template(identifier: str, user=Depends(editor), db=Depends(get_db)):
    item = owned(db, Template, identifier, user.organization_id)
    db.execute(delete(Attachment).where(Attachment.template_id == item.id))
    db.delete(item)
    audit(db, user, "template.deleted", identifier)
    db.commit()
    return {"ok": True}


@router.post("/templates/{identifier}/attachments/{document_id}", tags=["Templates"])
def template_attachment(
    identifier: str, document_id: str, user=Depends(editor), db=Depends(get_db)
):
    from app.models.entities import Campaign, CampaignRecipient

    owned(db, Template, identifier, user.organization_id)
    owned(db, Document, document_id, user.organization_id)
    existing = db.scalar(
        select(Attachment).where(
            Attachment.template_id == identifier, Attachment.document_id == document_id
        )
    )
    if not existing:
        db.add(
            Attachment(
                organization_id=user.organization_id,
                template_id=identifier,
                document_id=document_id,
            )
        )
        for campaign in db.scalars(
            select(Campaign)
            .join(CampaignRecipient)
            .where(CampaignRecipient.template_id == identifier, Campaign.status == "draft")
        ).unique():
            campaign.revision += 1
    db.commit()
    return {"ok": True}


@router.get("/smtp/accounts", tags=["SMTP"])
def smtp_accounts(user=Depends(current_user), db=Depends(get_db)):
    items = db.scalars(
        select(SMTPAccount).where(SMTPAccount.organization_id == user.organization_id)
    ).all()
    return {"items": [serialize(i, ("encrypted_password",)) for i in items]}


@router.post("/smtp/accounts", tags=["SMTP"], status_code=201)
def add_smtp(data: SMTPInput, user=Depends(admin), db=Depends(get_db)):
    from app.integrations.smtp import validate_host

    try:
        validate_host(data.host)
    except (ValueError, OSError) as error:
        raise HTTPException(422, str(error))
    item = SMTPAccount(
        organization_id=user.organization_id,
        encrypted_password=encrypt(data.password),
        **data.model_dump(exclude={"password"}),
    )
    db.add(item)
    db.flush()
    audit(db, user, "smtp.created", item.id)
    db.commit()
    return serialize(item, ("encrypted_password",))


@router.delete("/smtp/accounts/{identifier}", tags=["SMTP"])
def delete_smtp(identifier: str, user=Depends(admin), db=Depends(get_db)):
    item = owned(db, SMTPAccount, identifier, user.organization_id)
    db.delete(item)
    audit(db, user, "smtp.deleted", identifier)
    db.commit()
    return {"ok": True}


@router.post("/smtp/test", tags=["SMTP"])
def test_smtp(account_id: str, user=Depends(admin), db=Depends(get_db)):
    from app.integrations.smtp import connect

    item = owned(db, SMTPAccount, account_id, user.organization_id)
    try:
        with connect(item) as client:
            code, _ = client.noop()
            if code != 250:
                raise ValueError("SMTP NOOP failed")
    except Exception as error:
        raise HTTPException(422, "SMTP connection failed: " + type(error).__name__)
    item.tested_at = now()
    audit(db, user, "smtp.tested", item.id)
    db.commit()
    return {"ok": True, "tested_at": item.tested_at}


@router.get("/settings", tags=["Settings"])
def settings(user=Depends(current_user), db=Depends(get_db)):
    s = get_settings()
    prefs = db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    return {
        "preferences": prefs.preferences if prefs else {},
        "dry_run": s.dry_run,
        "max_emails_per_run": s.max_emails_per_run,
        "delay_between_emails": s.delay_between_emails,
        "max_attachment_bytes": s.max_attachment_bytes,
        "ai_provider": s.ai_provider,
        "ai_configured": bool(s.groq_api_key if s.ai_provider == "groq" else s.google_api_key),
        "malware_scan_configured": bool(s.clamav_host),
    }


@router.put("/settings", tags=["Settings"])
def save_settings(
    data: dict[str, str | bool | int], user=Depends(current_user), db=Depends(get_db)
):
    if len(str(data)) > 10000:
        raise HTTPException(422, "Preferences too large")
    item = db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    if not item:
        item = UserSettings(user_id=user.id, organization_id=user.organization_id)
        db.add(item)
    if "timezone" in data:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(str(data["timezone"]))
        except ZoneInfoNotFoundError:
            raise HTTPException(422, "Unknown timezone")
    item.preferences = data
    db.commit()
    return {"preferences": data}


@router.get("/audit-logs", tags=["Audit"])
def audit_logs(
    page_number: int = Query(1, ge=1, alias="page"), user=Depends(admin), db=Depends(get_db)
):
    return page(db, AuditLog, user.organization_id, page_number)


@router.get("/agents/executions", tags=["AI"])
def executions(user=Depends(current_user), db=Depends(get_db)):
    return page(db, AgentExecution, user.organization_id)


@router.get("/agents/executions/{identifier}", tags=["AI"])
def execution(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    item = owned(db, AgentExecution, identifier, user.organization_id)
    return {
        **serialize(item),
        "logs": [
            serialize(log)
            for log in db.scalars(
                select(AgentLog)
                .where(AgentLog.execution_id == identifier)
                .order_by(AgentLog.created_at)
            )
        ],
    }


@router.get("/notifications", tags=["Notifications"])
def notifications(user=Depends(current_user), db=Depends(get_db)):
    return page(db, Notification, user.organization_id)


@router.get("/documents/{identifier}/preview", tags=["Documents"])
def preview_document(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    from fastapi.responses import Response

    doc = owned(db, Document, identifier, user.organization_id)
    path = Path(get_settings().storage_path) / doc.storage_key
    extension = Path(doc.filename).suffix.lower()
    if extension == ".pdf":
        import fitz

        with fitz.open(path) as pdf:
            if not len(pdf):
                raise HTTPException(422, "PDF has no pages")
            page = pdf[0]
            scale = min(1.5, 1400 / max(page.rect.width, page.rect.height))
            return Response(
                page.get_pixmap(matrix=fitz.Matrix(scale, scale)).tobytes("png"),
                media_type="image/png",
                headers={"Cache-Control": "no-store"},
            )
    if extension in (".png", ".jpg", ".jpeg"):
        return FileResponse(path, media_type=doc.mime_type, headers={"Cache-Control": "no-store"})
    if extension in (".txt", ".csv", ".json", ".xml"):
        with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
            return Response(
                handle.read(100000),
                media_type="text/plain",
                headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
            )
    raise HTTPException(
        415,
        "Preview supports PDF first page, images, and text. Download this Office file to inspect it.",
    )


@router.get("/templates/{identifier}/attachments", tags=["Templates"])
def template_attachments(identifier: str, user=Depends(current_user), db=Depends(get_db)):
    owned(db, Template, identifier, user.organization_id)
    return {
        "items": [
            serialize(d, ("storage_key",))
            for d in db.scalars(
                select(Document)
                .join(Attachment, Attachment.document_id == Document.id)
                .where(Attachment.template_id == identifier)
            )
        ]
    }


@router.delete("/templates/{identifier}/attachments/{document_id}", tags=["Templates"])
def remove_template_attachment(
    identifier: str, document_id: str, user=Depends(editor), db=Depends(get_db)
):
    from app.models.entities import Campaign, CampaignRecipient

    owned(db, Template, identifier, user.organization_id)
    db.execute(
        delete(Attachment).where(
            Attachment.organization_id == user.organization_id,
            Attachment.template_id == identifier,
            Attachment.document_id == document_id,
        )
    )
    for campaign in db.scalars(
        select(Campaign)
        .join(CampaignRecipient)
        .where(CampaignRecipient.template_id == identifier, Campaign.status == "draft")
    ).unique():
        campaign.revision += 1
    audit(db, user, "template.attachment_removed", identifier, {"document_id": document_id})
    db.commit()
    return {"ok": True}
