# API guide

Interactive OpenAPI: `/docs`. JSON schema: `/openapi.json`. All product endpoints are under `/api/v1` and require a Bearer access token unless explicitly noted. Data ownership follows the authenticated organization. `page` starts at 1; list endpoints cap `limit` at 100 where exposed.

## Authentication

- `POST /auth/register`: name, organization, email, password (12+ characters); creates an isolated organization administrator.
- `POST /auth/login`: email and password.
- `POST /auth/refresh`: `refresh_token`; rotates the token once.
- `GET /auth/me`: current identity without password hash.
- `POST /auth/logout`: revokes refresh sessions and increments access-token version.

Registration/login/refresh are public and rate-limited. Product requests fail closed when Redis rate limiting is unavailable.

## Documents and recipients

- `POST /documents/upload`: multipart `file`; returns private metadata.
- `GET /documents`, `GET /documents/{id}`.
- `GET /documents/{id}/download`: authenticated original.
- `GET /documents/{id}/preview`: first PDF page as PNG, original supported image, or bounded text preview.
- `POST /documents/{id}/extract`: returns 202 with an extraction ID.
- `GET /documents/{id}/recipients`: latest extraction status, records, duplicates, error.
- `GET /recipients?q=...&page=1&limit=25`, `POST /recipients`, `PUT /recipients/{id}`, `DELETE /recipients/{id}`.
- `POST /recipients/{id}/consent`: `{ "granted": true, "source": "Documented evidence" }`.
- `GET /suppressions`, `POST /suppressions`: email and reason.

Editing a recipient's address is prohibited because consent must not silently transfer to a different address; create a new recipient instead. DELETE soft-deletes the recipient and blocks subsequent sending.

## Campaigns and messages

Create a draft with `POST /campaigns` or `POST /emails/compose`:

```json
{
  "name": "Partnership introductions",
  "description": "Reviewed contacts only",
  "subject": "A conversation with {{company}}",
  "body": "<p>Hello {{name}},</p><p>Could we schedule a conversation?</p>",
  "recipient_ids": ["recipient-uuid"],
  "recipient_templates": {},
  "attachment_ids": [],
  "smtp_account_id": null,
  "cc": [],
  "bcc": [],
  "scheduled_at": null
}
```

- `GET /campaigns?q=...&status=...&page=1`.
- `GET /campaigns/{id}` and `PUT /campaigns/{id}`.
- `GET /campaigns/{id}/preview`: personalized copies and eligibility.
- `POST /campaigns/{id}/review`: `{ "revision": 1, "confirm": true }`.
- `POST /campaigns/{id}/dry-run`: zero sends, personalized previews, current revision.
- `POST /campaigns/{id}/approve`: `{ "revision": 1, "confirm": true }`.
- `POST /campaigns/{id}/pause`, `/resume`, `/cancel`, `/duplicate`, `/retry`.
- `GET /campaigns/{id}/report`: CSV with formula-injection protection.
- `POST /emails/send-test`: campaign ID and signed-in account's recipient address.
- `GET /emails?q=...&status=...&campaign_id=...&sort=newest&page=1`; sort values: newest, oldest, recipient.
- `GET /emails/{id}`: complete body, snapshots, attempts, events, SMTP response, error.

409 indicates an invalid state transition or stale preflight. 422 identifies invalid recipients, missing fields, lack of consent, or size errors. A 200 approval means durable queue preparation, not successful SMTP delivery.

## Templates, AI, settings, analytics

- `GET/POST /templates`, `PUT /templates/{id}`.
- `GET /templates/{id}/attachments`, `POST/DELETE /templates/{id}/attachments/{document_id}`.
- `POST /ai/compose`: action, instruction, subject, body, tone.
- `POST /ai/analyze-document`: document_ids; queues extraction.
- `POST /ai/campaign-assistant`: instruction, optional campaign_id and document_ids; bounded planning/composition or analytics.
- `POST /ai/delivery-status`: campaign_id; actual queue-state inspection.
- `GET /agents/executions`, `GET /agents/executions/{id}`.
- `GET /analytics/overview`, `/analytics/emails?days=30`, `/analytics/campaigns`.
- `GET /events`: authenticated SSE metric snapshots, short connections reauthenticate on reconnect.
- `GET/POST /smtp/accounts`, `POST /smtp/test?account_id=...` (administrator writes).
- `GET/PUT /settings`, `GET /audit-logs` (administrator), `GET /notifications`.

## Confirmed provider events

`POST /webhooks/provider` is a server-to-server adapter endpoint. It is disabled unless `PROVIDER_WEBHOOK_SECRET` is set. The adapter must first authenticate the provider's original webhook, map its message ID to the stored Mailforge `Message-ID`, and then send:

```json
{"event_id":"unique-provider-event","message_id":"mailforge-message-uuid","kind":"delivered"}
```

Supported kinds: delivered, bounced, opened, clicked. Header `X-Mailforge-Signature` is the lowercase hexadecimal HMAC-SHA256 digest of the exact request-body bytes using the shared adapter secret. Event IDs deduplicate provider retries. Never give this secret to the browser or use fabricated events to fill analytics.

A minimal adapter signing operation is `hmac.new(secret, body_bytes, hashlib.sha256).hexdigest()`. Provider-specific signature verification, event authenticity, and message mapping are responsibilities of the adapter. SMTP acceptance alone must never generate a delivered event.

`GET /unsubscribe?token=...` displays confirmation; `POST` applies the signed organization-specific suppression. Unsubscribe tokens are intentionally durable to keep old emails actionable.
