# Bulk recipient import

Both recipient/document review screens submit selected rows using one
`POST /api/v1/recipients/import` request: `{ "recipients": [...] }`.
Every selected record requires a non-blank `name` and a valid `email`; the limit is 1,000 selected
contacts per request. The complete list is validated before writes, so an incomplete row never causes
a partial import.

The backend normalizes emails, keeps the first occurrence within the input, then executes a
PostgreSQL batch upsert inside one transaction. Account ownership comes from authenticated identity.
Active existing contacts are skipped, not overwritten; legacy soft-deleted contacts are restored.
The database's account/email unique constraint protects overlapping requests and repeated submissions.
Writes and the import audit record commit together, or roll back together on failure.

The response reports actual `{ added, duplicates, total }` counts. Restored contacts count as added;
duplicate counts include repeated input addresses and already-active contacts.
This provides duplicate-safe retries, not replay of an original response: if a response is lost
after commit, retry reports existing contacts instead of inserting them again.

The modal remains pending through the request and list synchronization. Toasts use response counts.
There is no fabricated percentage progress or automatic mutation retry. No schema migration is needed.

Verification covers 77 contacts in one frontend request, database batch insertion and retry,
within-file duplicates, separate accounts, invalid input and transaction rollback.
Live Neon import latency has not been benchmarked for this change.
