import unittest
from fastapi import HTTPException
from sqlalchemy import select
import test_private_accounts
from app.api.v1.resources import (
    create_recipient_group,
    update_recipient_group,
    delete_recipient_group,
    recipient_groups,
)
from app.models.entities import Recipient, RecipientGroup, GroupMember
from app.schemas.inputs import RecipientGroupInput


class RecipientGroupTests(unittest.TestCase):
    setUp = test_private_accounts.PrivateAccountTests.setUp
    tearDown = test_private_accounts.PrivateAccountTests.tearDown

    def add_recipient(self, user, email):
        record = Recipient(organization_id=user.organization_id, email=email, name=email.split('@')[0])
        self.db.add(record)
        self.db.flush()
        return record

    def test_group_lifecycle_is_private_and_persistent(self):
        first = self.add_recipient(self.users[0], 'first@example.com')
        second = self.add_recipient(self.users[0], 'second@example.com')
        third = self.add_recipient(self.users[0], 'third@example.com')
        foreign = self.add_recipient(self.users[1], 'foreign@example.com')
        foreign_second = self.add_recipient(self.users[1], 'foreign-second@example.com')
        self.db.commit()
        created = create_recipient_group(
            RecipientGroupInput(name='Launch list', recipient_ids=[first.id, second.id]), self.users[0], self.db
        )
        self.assertEqual(created['recipient_count'], 2)
        self.assertEqual(recipient_groups(self.users[0], self.db)['items'][0]['recipient_ids'], [first.id, second.id])
        updated = update_recipient_group(
            created['id'], RecipientGroupInput(name='Priority launch', recipient_ids=[second.id, third.id]), self.users[0], self.db
        )
        self.assertEqual(updated['name'], 'Priority launch')
        self.assertEqual(updated['recipient_ids'], [second.id, third.id])
        with self.assertRaises(HTTPException) as rejected:
            create_recipient_group(
                RecipientGroupInput(name='Foreign list', recipient_ids=[foreign.id, foreign_second.id]), self.users[0], self.db
            )
        self.assertEqual(rejected.exception.status_code, 422)
        delete_recipient_group(created['id'], self.users[0], self.db)
        self.assertIsNone(self.db.scalar(select(RecipientGroup).where(RecipientGroup.id == created['id'])))
        self.assertEqual(self.db.scalars(select(GroupMember)).all(), [])
