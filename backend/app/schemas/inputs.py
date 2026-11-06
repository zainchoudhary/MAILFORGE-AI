import re
from datetime import datetime
from typing import Literal
import bleach
from pydantic import BaseModel, EmailStr, Field, field_validator, ConfigDict


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Register(Input):
    name: str = Field(min_length=1, max_length=200)
    organization: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=5, max_length=128)

    @field_validator("password")
    @classmethod
    def strong_password(cls, value):
        if not all((any(char.isupper() for char in value), any(char.islower() for char in value), any(char.isdigit() for char in value), any(not char.isalnum() for char in value))):
            raise ValueError("Password must include an uppercase letter, lowercase letter, number, and special character")
        return value


class Login(Input):
    email: EmailStr
    password: str = Field(max_length=128)


class Refresh(Input):
    refresh_token: str


class ForgotPassword(Input):
    email: EmailStr


class ResetPassword(Input):
    token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=5, max_length=128)

    @field_validator("password")
    @classmethod
    def strong_password(cls, value):
        if not all((any(char.isupper() for char in value), any(char.islower() for char in value), any(char.isdigit() for char in value), any(not char.isalnum() for char in value))):
            raise ValueError("Password must include an uppercase letter, lowercase letter, number, and special character")
        return value


class RecipientInput(Input):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    company: str = Field(default="", max_length=200)
    position: str = Field(default="", max_length=200)
    custom_fields: dict[str, str] = Field(default_factory=dict)

    @field_validator("email")
    @classmethod
    def normalize(cls, value):
        return value.lower()

    @field_validator("name")
    @classmethod
    def required_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Name is required")
        return value


class BulkRecipientDelete(Input):
    recipient_ids: list[str] = Field(min_length=1, max_length=1000)


class BulkDocumentDelete(Input):
    document_ids: list[str] = Field(min_length=1, max_length=1000)


class BulkCampaignDelete(Input):
    campaign_ids: list[str] = Field(min_length=1, max_length=1000)


class BulkRecipientGroupDelete(Input):
    group_ids: list[str] = Field(min_length=1, max_length=1000)


class BulkRecipientImport(Input):
    recipients: list[RecipientInput] = Field(min_length=1, max_length=1000)


class RecipientGroupInput(Input):
    name: str = Field(min_length=1, max_length=200)
    recipient_ids: list[str] = Field(min_length=2, max_length=1000)

    @field_validator("name")
    @classmethod
    def required_group_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Group name is required")
        return value


class TemplateInput(Input):
    name: str = Field(min_length=1, max_length=200)
    subject: str = Field(min_length=1, max_length=998)
    body: str = Field(min_length=1, max_length=100000)

    @field_validator("subject")
    @classmethod
    def header(cls, value):
        if "\n" in value or "\r" in value:
            raise ValueError("Header must be a single line")
        return value

    @field_validator("body")
    @classmethod
    def sanitize(cls, value):
        return bleach.clean(
            value,
            tags={
                "p",
                "br",
                "strong",
                "em",
                "u",
                "ul",
                "ol",
                "li",
                "a",
                "blockquote",
                "h1",
                "h2",
                "h3",
                "span",
                "div",
            },
            attributes={"a": ["href", "title"]},
            protocols={"http", "https", "mailto"},
            strip=True,
        )


class CampaignInput(TemplateInput):
    description: str = Field(default="", max_length=10000)
    recipient_ids: list[str] = Field(default_factory=list, max_length=10000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=30)
    recipient_templates: dict[str, str] = Field(default_factory=dict)
    smtp_account_id: str | None = None
    cc: list[EmailStr] = Field(default_factory=list, max_length=20)
    bcc: list[EmailStr] = Field(default_factory=list, max_length=20)
    scheduled_at: datetime | None = None

    @field_validator("scheduled_at")
    @classmethod
    def timezone_required(cls, value):
        if value and value.tzinfo is None:
            raise ValueError("Use a timezone-aware schedule")
        return value


class Approval(Input):
    revision: int
    confirm: Literal[True]


class SMTPInput(Input):
    name: str = Field(min_length=1, max_length=200)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=587, ge=1, le=65535)
    security: Literal["starttls", "ssl"] = "starttls"
    username: str = Field(max_length=320)
    password: str = Field(min_length=1, max_length=1000)
    from_email: EmailStr


class AIInput(Input):
    action: Literal[
        "generate",
        "improve",
        "professional",
        "shorten",
        "expand",
        "grammar",
        "subject",
        "personalize",
        "copilot",
        "analytics",
        "plan",
    ] = "generate"
    instruction: str = Field(default="", max_length=10000)
    subject: str = Field(default="", max_length=998)
    body: str = Field(default="", max_length=20000)
    tone: Literal["professional", "formal", "friendly", "business"] = "professional"
    campaign_id: str | None = None
    document_ids: list[str] = Field(default_factory=list, max_length=10)


class TestEmail(Input):
    campaign_id: str
    recipient: EmailStr


class SuppressionInput(Input):
    email: EmailStr
    reason: str = Field(min_length=1, max_length=2000)


class LeadFinderRunInput(Input):
    instruction: str = Field(min_length=3, max_length=4000)
    target_count: int | None = Field(default=None, ge=1, le=100)

    @field_validator("instruction")
    @classmethod
    def trimmed_instruction(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Instruction is required")
        return value


class LeadCandidatePatch(Input):
    email: str | None = Field(default=None, max_length=320)
    name: str | None = Field(default=None, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    position: str | None = Field(default=None, max_length=200)
    selected: bool | None = None

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        if value is None:
            return value
        # Syntax-only check: extracted leads may use reserved/special-use domains (e.g. .test).
        value = value.strip().lower()
        if not re.fullmatch(r"[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;.]{2,}", value):
            raise ValueError("Enter a valid email address")
        return value


class LeadCandidatesSelectionInput(Input):
    """Bulk select / deselect for Select all — one request instead of N PATCHes."""

    selected: bool
    candidate_ids: list[str] = Field(min_length=1, max_length=200)


class LeadFinderSaveGroupInput(Input):
    group_name: str = Field(min_length=1, max_length=200)
    candidate_ids: list[str] | None = Field(default=None, max_length=1000)

    @field_validator("group_name")
    @classmethod
    def required_group_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Group name is required")
        return value
