import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, ForeignKey, DateTime, Boolean, Integer, UniqueConstraint, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database.session import Base


def now():
    return datetime.now(timezone.utc)


class Identity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class Tenant(Identity):
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)


class Organization(Identity, Base):
    __tablename__ = "organizations"
    name: Mapped[str] = mapped_column(String(200))


class User(Tenant, Base):
    __tablename__ = "users"
    # Every account owns a private namespace; sharing is disallowed at DB level.
    __table_args__ = (UniqueConstraint("organization_id", name="uq_users_private_namespace"),)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(30), default="admin")
    token_version: Mapped[int] = mapped_column(default=0)


class SMTPAccount(Tenant, Base):
    __tablename__ = "smtp_accounts"
    name: Mapped[str] = mapped_column(String(200))
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer, default=587)
    security: Mapped[str] = mapped_column(String(20), default="starttls")
    username: Mapped[str] = mapped_column(String(320))
    encrypted_password: Mapped[str] = mapped_column(Text)
    from_email: Mapped[str] = mapped_column(String(320))
    tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Document(Tenant, Base):
    __tablename__ = "uploaded_documents"
    filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(100), unique=True)
    mime_type: Mapped[str] = mapped_column(String(150))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    scan_status: Mapped[str] = mapped_column(String(30), default="not_configured")


class Extraction(Tenant, Base):
    __tablename__ = "document_extractions"
    document_id: Mapped[str] = mapped_column(ForeignKey("uploaded_documents.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    records: Mapped[list] = mapped_column(JSON, default=list)
    duplicates: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(Text)


class Recipient(Tenant, Base):
    __tablename__ = "recipients"
    __table_args__ = (UniqueConstraint("organization_id", "email"),)
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(200), default="")
    company: Mapped[str] = mapped_column(String(200), default="")
    position: Mapped[str] = mapped_column(String(200), default="")
    custom_fields: Mapped[dict] = mapped_column(JSON, default=dict)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class RecipientGroup(Tenant, Base):
    __tablename__ = "recipient_groups"
    name: Mapped[str] = mapped_column(String(200))


class GroupMember(Tenant, Base):
    __tablename__ = "recipient_group_members"
    __table_args__ = (UniqueConstraint("group_id", "recipient_id"),)
    group_id: Mapped[str] = mapped_column(ForeignKey("recipient_groups.id"))
    recipient_id: Mapped[str] = mapped_column(ForeignKey("recipients.id"))


class LeadSearchRun(Tenant, Base):
    __tablename__ = "lead_search_runs"
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    instruction: Mapped[str] = mapped_column(Text)
    brief: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    target_count: Mapped[int] = mapped_column(Integer, default=20)
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class LeadCandidate(Tenant, Base):
    __tablename__ = "lead_candidates"
    __table_args__ = (UniqueConstraint("run_id", "email"),)
    run_id: Mapped[str] = mapped_column(ForeignKey("lead_search_runs.id"), index=True)
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(200), default="")
    company: Mapped[str] = mapped_column(String(200), default="")
    position: Mapped[str] = mapped_column(String(200), default="")
    source_url: Mapped[str] = mapped_column(Text, default="")
    source_title: Mapped[str] = mapped_column(String(500), default="")
    snippet: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[float] = mapped_column(default=0)
    signals: Mapped[dict] = mapped_column(JSON, default=dict)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    existing_recipient_id: Mapped[str | None] = mapped_column(ForeignKey("recipients.id"))


class LinkedInCaptureRun(Tenant, Base):
    __tablename__ = "linkedin_capture_runs"
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    search_url: Mapped[str] = mapped_column(Text, default="")
    search_query_snapshot: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="idle", index=True)
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class LinkedInJobRaw(Tenant, Base):
    __tablename__ = "linkedin_job_raw"
    __table_args__ = (UniqueConstraint("run_id", "linkedin_job_id"),)
    run_id: Mapped[str] = mapped_column(ForeignKey("linkedin_capture_runs.id"), index=True)
    linkedin_job_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(500), default="")
    company: Mapped[str] = mapped_column(String(300), default="")
    location: Mapped[str] = mapped_column(String(300), default="")
    job_url: Mapped[str] = mapped_column(Text, default="")
    list_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    detail_payload: Mapped[dict | None] = mapped_column(JSON)
    detail_status: Mapped[str] = mapped_column(String(30), default="pending")


class LinkedInLeadCandidate(Tenant, Base):
    __tablename__ = "linkedin_lead_candidates"
    __table_args__ = (UniqueConstraint("run_id", "email"),)
    run_id: Mapped[str] = mapped_column(ForeignKey("linkedin_capture_runs.id"), index=True)
    job_raw_id: Mapped[str | None] = mapped_column(ForeignKey("linkedin_job_raw.id"))
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(200), default="")
    company: Mapped[str] = mapped_column(String(200), default="")
    position: Mapped[str] = mapped_column(String(200), default="")
    source_url: Mapped[str] = mapped_column(Text, default="")
    source_title: Mapped[str] = mapped_column(String(500), default="")
    snippet: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[float] = mapped_column(default=0)
    signals: Mapped[dict] = mapped_column(JSON, default=dict)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    existing_recipient_id: Mapped[str | None] = mapped_column(ForeignKey("recipients.id"))


class Consent(Tenant, Base):
    __tablename__ = "recipient_consents"
    recipient_id: Mapped[str] = mapped_column(ForeignKey("recipients.id"), index=True)
    granted: Mapped[bool] = mapped_column(Boolean)
    source: Mapped[str] = mapped_column(Text)


class Suppression(Tenant, Base):
    __tablename__ = "suppression_lists"
    __table_args__ = (UniqueConstraint("organization_id", "email"),)
    email: Mapped[str] = mapped_column(String(320))
    reason: Mapped[str] = mapped_column(Text)


class Template(Tenant, Base):
    __tablename__ = "email_templates"
    name: Mapped[str] = mapped_column(String(200))
    subject: Mapped[str] = mapped_column(String(998))
    body: Mapped[str] = mapped_column(Text)


class Campaign(Tenant, Base):
    __tablename__ = "campaigns"
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    subject: Mapped[str] = mapped_column(String(998))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    smtp_account_id: Mapped[str | None] = mapped_column(ForeignKey("smtp_accounts.id"))
    cc: Mapped[list] = mapped_column(JSON, default=list)
    bcc: Mapped[list] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(default=1)
    dry_run_revision: Mapped[int | None] = mapped_column(Integer)
    reviewed_revision: Mapped[int | None] = mapped_column(Integer)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CampaignRecipient(Tenant, Base):
    __tablename__ = "campaign_recipients"
    __table_args__ = (UniqueConstraint("campaign_id", "recipient_id"),)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id"), index=True)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("recipients.id"))
    template_id: Mapped[str | None] = mapped_column(ForeignKey("email_templates.id"))


class EmailMessage(Tenant, Base):
    __tablename__ = "email_messages"
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id"), index=True)
    recipient_id: Mapped[str | None] = mapped_column(ForeignKey("recipients.id"))
    recipient_email: Mapped[str] = mapped_column(String(320), index=True)
    recipient_name: Mapped[str] = mapped_column(String(200))
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    attempts: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(Text)
    smtp_response: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Attachment(Tenant, Base):
    __tablename__ = "email_attachments"
    document_id: Mapped[str] = mapped_column(ForeignKey("uploaded_documents.id"))
    campaign_id: Mapped[str | None] = mapped_column(ForeignKey("campaigns.id"), index=True)
    template_id: Mapped[str | None] = mapped_column(ForeignKey("email_templates.id"))
    message_id: Mapped[str | None] = mapped_column(ForeignKey("email_messages.id"), index=True)


class DeliveryAttempt(Tenant, Base):
    __tablename__ = "email_delivery_attempts"
    message_id: Mapped[str] = mapped_column(ForeignKey("email_messages.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30))
    response: Mapped[str | None] = mapped_column(Text)


class EmailEvent(Tenant, Base):
    __tablename__ = "email_events"
    message_id: Mapped[str] = mapped_column(ForeignKey("email_messages.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    provider_event_id: Mapped[str | None] = mapped_column(String(200), unique=True)


class ScheduledCampaign(Tenant, Base):
    __tablename__ = "scheduled_campaigns"
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id"), unique=True)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    dispatched: Mapped[bool] = mapped_column(default=False)


class AgentExecution(Tenant, Base):
    __tablename__ = "agent_executions"
    agent: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), default="running")
    input: Mapped[dict] = mapped_column(JSON, default=dict)
    output: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)


class AgentLog(Tenant, Base):
    __tablename__ = "agent_execution_logs"
    execution_id: Mapped[str] = mapped_column(ForeignKey("agent_executions.id"), index=True)
    step: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30))
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class Notification(Tenant, Base):
    __tablename__ = "notifications"
    title: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(default=False)


class AuditLog(Tenant, Base):
    __tablename__ = "audit_logs"
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[str | None] = mapped_column(String(36))
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class UserSettings(Tenant, Base):
    __tablename__ = "user_settings"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)


class RefreshSession(Tenant, Base):
    __tablename__ = "refresh_sessions"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(default=False)


class PasswordResetToken(Identity, Base):
    __tablename__ = "password_reset_tokens"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
