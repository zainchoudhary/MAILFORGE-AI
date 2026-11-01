# Deployment and operations

## Before first deployment

1. Provision a Neon PostgreSQL database and set `DATABASE_URL` in the private root `.env`.
2. Run `python3 scripts/setup_env.py` once if JWT/encryption secrets are not already present. Back up `.env` securely; losing the Fernet key makes stored passwords unrecoverable.
3. Set `PUBLIC_URL` to the actual HTTPS origin and `CORS_ORIGINS` to the allowed frontend origin. Configure Groq or Gemini only on the server.
4. Put HTTPS termination in front of the frontend and API (cloud load balancer or managed reverse proxy). Do not expose Redis or worker services publicly.
5. Run `alembic upgrade head`, then start FastAPI and Vite as separate processes. Check `/health` and process logs.
6. Register your workspace. Test document processing, recipient review, dry-run, and SMTP connection before changing live-mode configuration.

Run one scheduler instance; additional workers are supported when `REDIS_URL` is configured, but capacity and provider limits must be validated for the deployment.

## Live sending

Default values intentionally block production sending. Add and test SMTP credentials through the administrator-only settings API. Review real recipient consent and suppression behavior. Complete a dry run on each current campaign revision. Then set `DRY_RUN=false` in server `.env` and recreate backend, worker, and scheduler:

```bash
Restart the backend, worker, and scheduler processes after changing server `.env`.
```

The user still must explicitly approve each campaign. Do not disable review/approval checks. Use provider-specific rate and message-size limits. The default interval applies per organization, across all workers. SMTP acceptance is not confirmed delivery.

## Malware scanning

To require scanning, set:

```dotenv
CLAMAV_HOST=clamav
REQUIRE_MALWARE_SCAN=true
```

Run ClamAV as a separately managed service and set `CLAMAV_HOST` to its hostname. Uploads fail closed if a required/configured scanner is unavailable. Do not describe `not_configured` uploads as malware-free.

## Backups

- PostgreSQL: encrypted scheduled `pg_dump` backups plus tested restore procedures or managed PostgreSQL PITR.
- Uploads volume: back up alongside database snapshots. Attachment records refer to private random storage keys.
- Environment secrets: store separately in a secret manager or encrypted operator vault. Preserve encryption-key continuity.
- Redis: broker persistence is enabled, but PostgreSQL remains the durable queue source. Redis can be reconstructed; approved campaign work is rediscovered by the dispatcher.

Example logical backup (redirect to a secure operator-managed location):

```bash
Use Neon backups/PITR or `pg_dump "$DATABASE_URL" > mailforge-backup.sql` from a secure operator-managed location.
```

Do not commit backups, `.env`, uploaded documents, or SMTP passwords.

## Updates

Back up database/uploads before upgrading. Run `alembic upgrade head` once during deployment, then restart application processes. Add explicit Alembic revisions for future schema changes; do not edit the applied `0001` migration. `alembic check` detects ORM/schema drift. Avoid running migrations from every web worker.

## Troubleshooting

| Symptom | Check |
|---|---|
| API returns 503 for product requests | If Redis is configured, check Redis reachability; leave `REDIS_URL` blank for API-only local development |
| Upload accepted but extraction stays pending | Celery worker, broker, native parser dependencies, extraction execution logs |
| OCR unavailable | Tesseract binary and language packs; Docker installs English defaults |
| DOC parsing fails locally | antiword; available in the Debian-based Docker image |
| AI returns configuration error | Server-side provider key, selected model availability, outbound access |
| Approval returns 409 | Server dry-run, stale revision, missing review/dry-run, non-draft status |
| Approval returns 422 | Missing consent, suppression, SMTP account test, invalid personalization, attachment size |
| SMTP account cannot connect | Provider app password, DNS, TLS port/security, firewall/outbound access |
| Message is uncertain | Inspect provider logs; do not automatically retry an ambiguous DATA transaction |
| No confirmed delivery/open/click metrics | Plain SMTP does not provide those signals; connect a verified signed provider adapter |
| Scheduled campaign does not start | Scheduler process, timezone-aware due time, approved status, worker/broker |
| File download missing after restart | Persistent uploads volume and matching database restore |

## Security and scaling notes

- Production Nginx ships a CSP, private API proxy, body limit, and unbuffered SSE. Swagger has a separate documentation CSP for its static CDN assets.
- SMTP rejects private/reserved host addresses by default. `ALLOW_PRIVATE_SMTP=true` is for controlled internal deployments only. Public SaaS deployments should additionally restrict outbound network routes at the infrastructure layer to resist DNS rebinding.
- Backend request rate limiting currently keys unauthenticated traffic by observed client address. Configure trusted proxy forwarding deliberately if deploying behind another proxy; do not trust arbitrary internet-supplied forwarding headers.
- Long model requests currently run in FastAPI's worker thread pool; document parsing and SMTP run in Celery. Higher-volume AI usage should use a dedicated async job/result workflow and per-tenant budgets.
- Storage is a shared local volume, not an S3 adapter. Multi-host workers must share the private storage mount or implement a storage adapter.
- Audit logs are application records, not an independently immutable external compliance ledger. Restrict database operator access and configure external log retention as needed.
- Run vulnerability scans and load tests for your deployment. The test suite checks important workflows; it is not a certification of production security or deliverability.
