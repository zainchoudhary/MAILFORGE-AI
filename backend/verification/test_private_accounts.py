"""Run independently: python -m unittest discover -s verification -v.

Uses only an in-memory SQLite database with enforced foreign keys.
"""
import unittest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from app.database.session import Base
from app.models.entities import Organization, User, Recipient, Campaign, CampaignRecipient, EmailMessage, Consent
from app.services.recipients import permanently_delete


class PrivateAccountTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        @event.listens_for(self.engine, 'connect')
        def foreign_keys(connection, record):
            connection.execute('PRAGMA foreign_keys=ON')
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.users = []
        for index in range(2):
            org = Organization(name=f'Private {index}')
            self.db.add(org)
            self.db.flush()
            user = User(organization_id=org.id, email=f'u{index}@example.com', name='QA', password_hash='unused')
            self.db.add(user)
            self.users.append(user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def contact(self, user):
        row = Recipient(organization_id=user.organization_id, email='same@example.com')
        self.db.add(row)
        self.db.commit()
        return row

    def test_unique_private_namespace(self):
        self.db.add(User(organization_id=self.users[0].organization_id, email='third@example.com', name='Third', password_hash='unused'))
        with self.assertRaises(IntegrityError):
            self.db.commit()

    def test_foreign_bulk_delete_is_atomic(self):
        own = self.contact(self.users[0])
        foreign = self.contact(self.users[1])
        with self.assertRaises(HTTPException) as error:
            permanently_delete(self.db, self.users[0], [own.id, foreign.id])
        self.assertEqual(error.exception.status_code, 404)
        self.db.rollback()
        self.assertIsNotNone(self.db.get(Recipient, own.id))
        self.assertIsNotNone(self.db.get(Recipient, foreign.id))

    def test_permanent_delete_and_recreate(self):
        row = self.contact(self.users[0])
        identifier = row.id
        permanently_delete(self.db, self.users[0], [identifier, identifier])
        self.db.expire_all()
        self.assertIsNone(self.db.scalar(select(Recipient).where(Recipient.id == identifier)))
        replacement = self.contact(self.users[0])
        self.assertNotEqual(replacement.id, identifier)

    def test_history_preserved_and_queued_delivery_cancelled(self):
        user = self.users[0]
        row = self.contact(user)
        campaign = Campaign(organization_id=user.organization_id, name='QA', subject='Hello', body='Hello', revision=1)
        self.db.add(campaign)
        self.db.flush()
        self.db.add(CampaignRecipient(organization_id=user.organization_id, campaign_id=campaign.id, recipient_id=row.id))
        self.db.add(Consent(organization_id=user.organization_id, recipient_id=row.id, granted=True, source='QA'))
        message = EmailMessage(organization_id=user.organization_id, campaign_id=campaign.id, recipient_id=row.id,
            recipient_email=row.email, recipient_name='QA', subject='Hello', body='Hello', idempotency_key='qa-message')
        self.db.add(message)
        self.db.commit()
        permanently_delete(self.db, user, [row.id])
        self.db.refresh(message)
        self.assertIsNone(message.recipient_id)
        self.assertEqual(message.status, 'cancelled')
        self.assertEqual(message.recipient_email, 'same@example.com')
        self.assertEqual(campaign.revision, 2)
        self.assertEqual(list(self.db.scalars(select(Consent))), [])

if __name__ == '__main__':
    unittest.main()
