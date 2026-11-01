# Live verification — 2026-11-01

The running localhost API and frontend were reachable. API health returned `ok`.
Celery inspect returned one online worker. Tests used a newly registered synthetic organization,
not existing user records. No email was approved or sent.

## Completed live HTTP workflow

- Registration and authenticated profile reads.
- Recipients, documents, campaigns, templates, email activity, settings, SMTP account listing.
- Analytics overview/email/campaign endpoints, audit logs and agent execution listing.
- CSV upload, asynchronous extraction through the worker, two unique contacts and one duplicate.
- Recipient persistence, duplicate rejection (409), list count verification and editing.
- Template and campaign creation, campaign detail/preview/review and dry-run (`sent=0`).
- Campaign/template/document deletion and recipient bulk soft-delete; verified empty recipient list.
- Logout followed by rejected authenticated access (401).

First-run observed request times: recipient list 1.52–1.68s, recipient create 1.70–1.86s,
bulk delete 1.61s, campaign preview 2.91s, campaign review 3.42s, campaign delete 4.17s.
These are end-to-end HTTP measurements, not isolated database timings or load-test percentiles.

Campaign preview was subsequently changed to bulk-load recipients, templates, suppression and
consent data rather than repeat queries for every recipient. Expected query growth is constant
with recipient count; production throughput still needs a measured load test.

Post-change repeat: preview 2.32s, review 2.87s, dry-run 3.12s (two recipients).
These small samples indicate lower latency but are not a controlled benchmark.

## UI validation

11 frontend regression tests passed. Coverage includes imports from untouched worker results,
empty selections, duplicates, partial failure, mutation synchronization, duplicate clicks,
pending button locks and confirmation failure/retry. Production build completed with exit code 0.
Build reports a large bundle warning and dependency annotation warnings.

## Outstanding

A repeat run immediately after a backend source edit timed out on registration after 45 seconds;
the subsequent health request succeeded. Reload timing is a possibility, not a proven cause.
This transient timeout remains a reliability observation requiring operational monitoring.

Browser runtime discovery returned no available browsers. Live rendered UI interaction remains
blocked until a browser is connected; component tests do not replace that check.
Paid AI-provider calls and actual SMTP sending were not exercised.
Synthetic accounts/audit records and soft-deleted contacts remain in the isolated test organizations.
