"""Explicit navigation relationships; FK ownership checks remain in repositories."""

from sqlalchemy.orm import relationship
from app.models.entities import (
    Organization,
    User,
    Campaign,
    CampaignRecipient,
    Recipient,
    EmailMessage,
    DeliveryAttempt,
    EmailEvent,
    Document,
    Extraction,
    Attachment,
    AgentExecution,
    AgentLog,
)

Organization.users = relationship(User, back_populates="organization")
User.organization = relationship(Organization, back_populates="users")
Campaign.recipient_links = relationship(
    CampaignRecipient, back_populates="campaign", cascade="all, delete-orphan"
)
CampaignRecipient.campaign = relationship(Campaign, back_populates="recipient_links")
CampaignRecipient.recipient = relationship(Recipient)
Campaign.messages = relationship(EmailMessage, back_populates="campaign")
EmailMessage.campaign = relationship(Campaign, back_populates="messages")
EmailMessage.delivery_attempts = relationship(DeliveryAttempt, back_populates="message")
DeliveryAttempt.message = relationship(EmailMessage, back_populates="delivery_attempts")
EmailMessage.events = relationship(EmailEvent, back_populates="message")
EmailEvent.message = relationship(EmailMessage, back_populates="events")
Document.extractions = relationship(Extraction, back_populates="document")
Extraction.document = relationship(Document, back_populates="extractions")
Attachment.document = relationship(Document)
AgentExecution.logs = relationship(AgentLog, back_populates="execution")
AgentLog.execution = relationship(AgentExecution, back_populates="logs")
