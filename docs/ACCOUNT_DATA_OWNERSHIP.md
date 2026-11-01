# Private accounts and persisted data

Each registration creates a fresh private organization/namespace. The database constraint
`uq_users_private_namespace` allows exactly one user per namespace. Existing organization filters
therefore enforce account isolation across contacts, files, campaigns, SMTP configuration, audit
history and analytics. User input cannot choose the namespace; it comes from authenticated identity.
This product does not support adding a second user to an existing namespace.

Migration 0002 refuses to guess ownership if any legacy namespace has multiple users. A live
read-only preflight found zero such namespaces. Login clears the frontend query cache so a new
account cannot inherit another account's cached lists.

Create and update endpoints commit real SQL transactions. Recipient DELETE and bulk-delete now
physically delete rows in `recipients`, plus recipient consents, group memberships and campaign
recipient links. Bulk requests containing another account's ID fail atomically with 404.
Affected campaign reviews are invalidated. Queued messages are cancelled before detaching their
recipient reference. Sending messages cause a retryable 409 instead of racing SMTP delivery.

Existing sent-message history retains its email/name/body snapshots and audit records remain.
Deleting a contact is not an erasure of all historical mentions or original uploaded documents.
Old soft-deleted contacts are not automatically purged by the migration. New delete requests
physically remove records, including a known legacy soft-deleted ID.

Verification: isolated SQLite tests enable foreign keys and assert actual row absence, same email
in different accounts, atomic cross-account rejection, the unique-account constraint, linked history
preservation and queued-message cancellation. Run with:

```sh
cd backend
.venv/bin/python -m unittest discover -s verification -v
```

## Deployment verification

Neon migration confirmed at `0002 (head)`. Live verification with two new synthetic accounts
passed: private lists, foreign-ID update/delete/bulk-delete rejection, independent same-email
contacts, persisted create/update checked directly in PostgreSQL, and actual row absence after
single and bulk deletion. Synthetic contacts were removed; test accounts and audit records remain.
Frontend regression suite: 11 passing tests. Isolated backend suite: 4 passing tests.
