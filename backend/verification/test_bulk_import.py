import unittest
from unittest import mock
from sqlalchemy import select, func
from pydantic import ValidationError
import test_private_accounts
from app.models.entities import Recipient
from app.schemas.inputs import BulkRecipientImport
from app.services.recipient_import import import_batch


class BulkImportTests(unittest.TestCase):
    setUp = test_private_accounts.PrivateAccountTests.setUp
    tearDown = test_private_accounts.PrivateAccountTests.tearDown
    def batch(self, addresses):
        return BulkRecipientImport(recipients=[{'email': address} for address in addresses]).recipients

    def test_77_import_and_retry(self):
        records = self.batch([f'contact{i}@example.com' for i in range(77)])
        first = import_batch(self.db, self.users[0], records)
        self.assertEqual(first, {'added': 77, 'duplicates': 0, 'total': 77})
        retry = import_batch(self.db, self.users[0], records)
        self.assertEqual(retry['added'], 0)
        self.assertEqual(retry['duplicates'], 77)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Recipient)), 77)

    def test_internal_duplicates_and_private_accounts(self):
        records = self.batch(['Alex@example.com', 'alex@example.com'])
        self.assertEqual(import_batch(self.db, self.users[0], records)['added'], 1)
        self.assertEqual(import_batch(self.db, self.users[1], records)['added'], 1)

    def test_invalid_batch_rejected_before_writes(self):
        with self.assertRaises(ValidationError):
            self.batch(['valid@example.com', 'invalid'])
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Recipient)), 0)

    def test_audit_failure_rolls_back_whole_batch(self):
        records = self.batch(['new@example.com'])
        with mock.patch('app.services.recipient_import.audit', side_effect=RuntimeError('failed')):
            with self.assertRaises(RuntimeError):
                import_batch(self.db, self.users[0], records)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Recipient)), 0)
