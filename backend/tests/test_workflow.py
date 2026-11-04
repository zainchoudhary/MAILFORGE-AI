import hashlib
import hmac
import json
from sqlalchemy import select, func
from app.models.entities import Campaign, SMTPAccount, EmailMessage, DeliveryAttempt, RecipientGroup, GroupMember, now
from app.core.config import get_settings
from app.security.auth import encrypt


def recipient(client, headers, email="alex@example.com"):
    response = client.post(
        "/api/v1/recipients",
        headers=headers,
        json={"email": email, "name": "Alex <script>", "company": "Example"},
    )
    assert response.status_code == 201, response.text
    record = response.json()
    return record


def test_recipient_groups_are_reported_and_empty_groups_are_removed(client, account, db):
    contact = recipient(client, account)
    teammate = recipient(client, account, "teammate@example.com")
    group = client.post(
        "/api/v1/recipient-groups",
        headers=account,
        json={"name": "Design candidates", "recipient_ids": [contact["id"], teammate["id"]]},
    )
    assert group.status_code == 201, group.text

    groups = client.get("/api/v1/recipient-groups", headers=account)
    assert groups.status_code == 200, groups.text
    listed_group = next(item for item in groups.json()["items"] if item["id"] == group.json()["id"])
    assert [member["id"] for member in listed_group["recipient_members"]] == [contact["id"], teammate["id"]]

    memberships = client.get(f"/api/v1/recipients/{contact['id']}/groups", headers=account)
    assert memberships.status_code == 200, memberships.text
    assert memberships.json()["items"] == [{"id": group.json()["id"], "name": "Design candidates"}]

    recipient_list = client.get("/api/v1/recipients", headers=account)
    listed_contact = next(item for item in recipient_list.json()["items"] if item["id"] == contact["id"])
    assert listed_contact["recipient_groups"] == [{"id": group.json()["id"], "name": "Design candidates"}]

    deleted = client.delete(f"/api/v1/recipients/{contact['id']}", headers=account)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["auto_deleted_groups"] == []
    assert db.get(RecipientGroup, group.json()["id"]) is not None

    deleted = client.delete(f"/api/v1/recipients/{teammate['id']}", headers=account)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["auto_deleted_groups"] == [{"id": group.json()["id"], "name": "Design candidates"}]
    assert db.get(RecipientGroup, group.json()["id"]) is None
    assert db.scalar(select(GroupMember).where(GroupMember.group_id == group.json()["id"])) is None


def campaign(client, headers, ids, **kwargs):
    response = client.post(
        "/api/v1/campaigns",
        headers=headers,
        json={
            "name": "Test campaign",
            "subject": "Hello {{name}}",
            "body": "<p>Hello {{name}} from {{company}}</p>",
            "recipient_ids": ids,
            **kwargs,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def preflight(client, headers, c):
    assert (
        client.post(
            f"/api/v1/campaigns/{c['id']}/review",
            headers=headers,
            json={"revision": c["revision"], "confirm": True},
        ).status_code
        == 200
    )
    result = client.post(f"/api/v1/campaigns/{c['id']}/dry-run", headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()["sent"] == 0


def enable_smtp(db, c):
    record = db.get(Campaign, c["id"])
    account = SMTPAccount(
        organization_id=record.organization_id,
        name="Test",
        host="smtp.example.com",
        port=587,
        security="starttls",
        username="test",
        encrypted_password=encrypt("test-password"),
        from_email="sender@example.com",
        tested_at=now(),
    )
    db.add(account)
    db.flush()
    record.smtp_account_id = account.id
    db.commit()
    get_settings().dry_run = False


def test_auth_refresh_rotation_and_isolation(client, account):
    r = recipient(client, account)
    other = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other@example.com",
            "password": "Another-test1!",
            "name": "Other",
            "organization": "Other org",
        },
    ).json()
    headers = {"Authorization": "Bearer " + other["access_token"]}
    assert client.get("/api/v1/recipients", headers=headers).json()["total"] == 0
    assert client.delete("/api/v1/recipients/" + r["id"], headers=headers).status_code == 404
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": other["refresh_token"]})
    assert refreshed.status_code == 200
    assert (
        client.post(
            "/api/v1/auth/refresh", json={"refresh_token": other["refresh_token"]}
        ).status_code
        == 401
    )
    assert client.get("/api/v1/campaigns").status_code in (401, 403)


def test_dry_run_sends_nothing_and_production_is_gated(client, account, db):
    r = recipient(client, account)
    c = campaign(client, account, [r["id"], r["id"]])
    url = f"/api/v1/campaigns/{c['id']}"
    assert (
        client.post(
            url + "/approve", headers=account, json={"revision": 1, "confirm": True}
        ).status_code
        == 409
    )
    preflight(client, account, c)
    assert db.scalar(select(func.count()).select_from(EmailMessage)) == 0
    assert (
        client.post(
            url + "/approve", headers=account, json={"revision": 1, "confirm": True}
        ).status_code
        == 409
    )
    p = client.get(url + "/preview", headers=account).json()["items"]
    assert len(p) == 1 and "&lt;script&gt;" in p[0]["body"]
    assert client.get("/api/v1/analytics/overview", headers=account).json()["smtp_accepted"] == 0


def test_queue_delivery_idempotency_and_actual_metrics(client, account, db, monkeypatch):
    r = recipient(client, account)
    c = campaign(client, account, [r["id"]])
    preflight(client, account, c)
    enable_smtp(db, c)
    url = f"/api/v1/campaigns/{c['id']}"
    assert (
        client.post(
            url + "/approve", headers=account, json={"revision": 1, "confirm": True}
        ).status_code
        == 200
    )
    assert (
        client.post(
            url + "/approve", headers=account, json={"revision": 1, "confirm": True}
        ).status_code
        == 409
    )
    message = db.scalar(select(EmailMessage))
    from app.workers import tasks

    calls = []
    monkeypatch.setattr(tasks, "send", lambda *args: calls.append(args[0].id) or "250 accepted")
    tasks.deliver.run(message.id)
    tasks.deliver.run(message.id)
    assert calls == [message.id]
    db.expire_all()
    assert db.get(EmailMessage, message.id).status == "smtp_accepted"
    assert db.scalar(select(func.count()).select_from(DeliveryAttempt)) == 1
    metrics = client.get("/api/v1/analytics/overview", headers=account).json()
    assert metrics["smtp_accepted"] == 1 and metrics["confirmed_deliveries"] == 0
    detail = client.get("/api/v1/emails/" + message.id, headers=account).json()
    assert detail["attempts_history"][0]["response"] == "250 accepted"
    assert client.get(url + "/report", headers=account).status_code == 200


def test_suppression_does_not_block_approval(client, account, db):
    r = recipient(client, account)
    assert client.post(
        "/api/v1/suppressions",
        headers=account,
        json={"email": r["email"], "reason": "Recipient opted out"},
    ).status_code == 201
    c = campaign(client, account, [r["id"]])
    preflight(client, account, c)
    enable_smtp(db, c)
    result = client.post(
        f"/api/v1/campaigns/{c['id']}/approve",
        headers=account,
        json={"revision": 1, "confirm": True},
    )
    assert result.status_code == 200, result.text
    assert db.scalar(select(func.count()).select_from(EmailMessage)) == 1


def test_changes_invalidate_preflight(client, account):
    r = recipient(client, account)
    c = campaign(client, account, [r["id"]])
    preflight(client, account, c)
    response = client.put(
        f"/api/v1/campaigns/{c['id']}",
        headers=account,
        json={
            "name": "Changed",
            "subject": "Changed",
            "body": "<p>Updated</p>",
            "recipient_ids": [r["id"]],
        },
    )
    assert response.status_code == 200
    assert response.json()["revision"] == 2
    assert (
        client.post(
            f"/api/v1/campaigns/{c['id']}/approve",
            headers=account,
            json={"revision": 2, "confirm": True},
        ).status_code
        == 409
    )


def test_signed_provider_confirmation(client, account, db, monkeypatch):
    r = recipient(client, account)
    c = campaign(client, account, [r["id"]])
    preflight(client, account, c)
    enable_smtp(db, c)
    client.post(
        f"/api/v1/campaigns/{c['id']}/approve",
        headers=account,
        json={"revision": 1, "confirm": True},
    )
    msg = db.scalar(select(EmailMessage))
    get_settings().provider_webhook_secret = "test-provider-secret"
    payload = json.dumps({"event_id": "evt-1", "message_id": msg.id, "kind": "delivered"}).encode()
    signature = hmac.new(b"test-provider-secret", payload, hashlib.sha256).hexdigest()
    assert (
        client.post(
            "/api/v1/webhooks/provider", content=payload, headers={"x-mailforge-signature": "bad"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/webhooks/provider",
            content=payload,
            headers={"x-mailforge-signature": signature},
        ).status_code
        == 200
    )
    assert client.post(
        "/api/v1/webhooks/provider", content=payload, headers={"x-mailforge-signature": signature}
    ).json()["duplicate"]
    assert (
        client.get("/api/v1/analytics/overview", headers=account).json()["confirmed_deliveries"]
        == 1
    )


def test_pause_cancel_and_uncertain_outcomes(client, account, db, monkeypatch):
    import smtplib

    r = recipient(client, account)
    c = campaign(client, account, [r["id"]])
    preflight(client, account, c)
    enable_smtp(db, c)
    url = f"/api/v1/campaigns/{c['id']}"
    client.post(url + "/approve", headers=account, json={"revision": 1, "confirm": True})
    msg = db.scalar(select(EmailMessage))
    assert client.post(url + "/pause", headers=account).status_code == 200
    from app.workers import tasks

    calls = []
    monkeypatch.setattr(tasks, "send", lambda *args: calls.append(1))
    tasks.deliver.run(msg.id)
    assert calls == []
    assert client.post(url + "/resume", headers=account).status_code == 200

    def disconnect(*args):
        raise smtplib.SMTPServerDisconnected("lost after DATA")

    monkeypatch.setattr(tasks, "send", disconnect)
    tasks.deliver.run(msg.id)
    db.expire_all()
    assert db.get(EmailMessage, msg.id).status == "uncertain"
    tasks.deliver.run(msg.id)
    assert db.get(EmailMessage, msg.id).attempts == 1


def test_upload_extract_and_tenant_file_access(client, account, db):
    from app.workers import tasks

    response = client.post(
        "/api/v1/documents/upload",
        headers=account,
        files={
            "file": (
                "contacts.csv",
                b"email,name,company\nalex@example.com,Alex,Acme\nalex@example.com,Alex,Acme\n",
                "text/csv",
            )
        },
    )
    assert response.status_code == 201, response.text
    doc = response.json()
    assert "storage_key" not in doc
    extraction = client.post(f"/api/v1/documents/{doc['id']}/extract", headers=account)
    assert extraction.status_code == 202, extraction.text
    tasks.extract_document.run(extraction.json()["id"])
    result = client.get(f"/api/v1/documents/{doc['id']}/recipients", headers=account).json()
    assert result["status"] == "completed", result
    assert len(result["records"]) == 1 and result["duplicates"] == 1
    assert result["records"][0]["name"] == "Alex"
    assert client.get("/api/v1/recipients", headers=account).json()["total"] == 0
    assert client.get(f"/api/v1/documents/{doc['id']}/download").status_code in (401, 403)
    bad = client.post(
        "/api/v1/documents/upload",
        headers=account,
        files={"file": ("fake.pdf", b"not a PDF", "application/pdf")},
    )
    assert bad.status_code == 415


def test_ai_missing_key_fails_honestly(client, account):
    get_settings().groq_api_key = ""
    get_settings().ai_provider = "groq"
    response = client.post(
        "/api/v1/ai/compose", headers=account, json={"instruction": "Write an introduction"}
    )
    assert response.status_code == 503
    assert (
        client.get("/api/v1/agents/executions", headers=account).json()["items"][0]["status"]
        == "failed"
    )


def test_private_preview_and_template_attachment_lifecycle(client, account):
    upload = client.post(
        "/api/v1/documents/upload",
        headers=account,
        files={"file": ("note.txt", b"Private attachment contents", "text/plain")},
    )
    assert upload.status_code == 201
    doc = upload.json()
    assert (
        client.get(f"/api/v1/documents/{doc['id']}/preview", headers=account).text
        == "Private attachment contents"
    )
    assert client.get(f"/api/v1/documents/{doc['id']}/preview").status_code in (401, 403)
    template = client.post(
        "/api/v1/templates",
        headers=account,
        json={"name": "Attachment template", "subject": "Hello", "body": "<p>Hello</p>"},
    ).json()
    url = f"/api/v1/templates/{template['id']}/attachments"
    assert client.post(url + "/" + doc["id"], headers=account).status_code == 200
    assert len(client.get(url, headers=account).json()["items"]) == 1
    assert client.delete(url + "/" + doc["id"], headers=account).status_code == 200
    assert client.get(url, headers=account).json()["items"] == []
