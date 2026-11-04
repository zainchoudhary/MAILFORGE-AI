import smtplib
from datetime import timedelta
from sqlalchemy import select
from app.models.entities import Campaign, EmailMessage, now
from test_workflow import recipient, campaign, preflight, enable_smtp


def test_enqueue_deliveries_publishes_a_message_once_while_its_lease_exists(monkeypatch):
    from app.workers import tasks

    class FakeRedis:
        keys = set()

        def set(self, key, value, nx=False, ex=None):
            if nx and key in self.keys:
                return False
            self.keys.add(key)
            return True

    published = []
    fake_redis = FakeRedis()
    monkeypatch.setattr(tasks.Redis, "from_url", lambda _: fake_redis)
    monkeypatch.setattr(
        tasks.deliver,
        "apply_async",
        lambda **kwargs: published.append(kwargs),
    )

    tasks.enqueue_deliveries([("message-1", "workspace-1")])
    tasks.enqueue_deliveries([("message-1", "workspace-1")])

    assert published == [{"args": ["message-1"], "countdown": 0}]


def test_dispatch_lock_allows_only_one_recovery_run(monkeypatch):
    from app.workers import tasks

    class FakeRedis:
        keys = set()

        def set(self, key, value, nx=False, ex=None):
            if nx and key in self.keys:
                return False
            self.keys.add(key)
            return True

    fake_redis = FakeRedis()
    monkeypatch.setattr(tasks.Redis, "from_url", lambda _: fake_redis)

    assert tasks.claim_dispatch_lock() is True
    assert tasks.claim_dispatch_lock() is False


def approved(client, account, db, **kwargs):
    r = recipient(client, account)
    c = campaign(client, account, [r["id"]], **kwargs)
    preflight(client, account, c)
    enable_smtp(db, c)
    response = client.post(
        f"/api/v1/campaigns/{c['id']}/approve",
        headers=account,
        json={"revision": 1, "confirm": True},
    )
    assert response.status_code == 200, response.text
    return c, db.scalar(select(EmailMessage))


def test_transient_smtp_rejection_uses_backoff(client, account, db, monkeypatch):
    c, msg = approved(client, account, db)
    from app.workers import tasks

    def temporary(*args):
        raise smtplib.SMTPResponseException(451, b"Try later")

    monkeypatch.setattr(tasks, "send", temporary)
    tasks.deliver.run(msg.id)
    db.expire_all()
    msg = db.get(EmailMessage, msg.id)
    assert msg.status == "queued" and msg.next_attempt_at > now()
    tasks.deliver.run(msg.id)
    db.expire_all()
    assert db.get(EmailMessage, msg.id).attempts == 1


def test_transient_smtp_rejection_schedules_its_own_retry(client, account, db, monkeypatch):
    c, msg = approved(client, account, db)
    from app.workers import tasks

    monkeypatch.setattr(
        tasks,
        "send",
        lambda *args: (_ for _ in ()).throw(smtplib.SMTPResponseException(451, b"Try later")),
    )
    scheduled = []
    monkeypatch.setattr(tasks.deliver, "apply_async", lambda **kwargs: scheduled.append(kwargs))

    tasks.deliver.run(msg.id)

    assert scheduled == [{"args": [msg.id], "countdown": 30}]


def test_suppression_does_not_cancel_a_queued_delivery(client, account, db, monkeypatch):
    c, msg = approved(client, account, db)
    client.post(
        "/api/v1/suppressions",
        headers=account,
        json={"email": msg.recipient_email, "reason": "Opt-out received after approval"},
    )
    from app.workers import tasks

    calls = []
    monkeypatch.setattr(tasks, "send", lambda *args: calls.append(1) or "250 accepted")
    tasks.deliver.run(msg.id)
    db.expire_all()
    assert calls == [1] and db.get(EmailMessage, msg.id).status == "smtp_accepted"


def test_scheduled_campaign_not_dispatched_early(client, account, db, monkeypatch):
    c, msg = approved(client, account, db, scheduled_at=(now() + timedelta(hours=1)).isoformat())
    from app.workers import tasks

    queued = []
    monkeypatch.setattr(tasks.deliver, "delay", lambda identifier: queued.append(identifier))
    tasks.dispatch.run()
    assert queued == []
    db.expire_all()
    assert db.get(Campaign, c["id"]).status == "scheduled"


def test_stale_smtp_lease_never_auto_resends(client, account, db, monkeypatch):
    c, msg = approved(client, account, db)
    msg.status = "sending"
    msg.lease_until = now() - timedelta(minutes=1)
    db.commit()
    from app.workers import tasks

    queued = []
    monkeypatch.setattr(tasks.deliver, "delay", lambda identifier: queued.append(identifier))
    tasks.dispatch.run()
    db.expire_all()
    assert db.get(EmailMessage, msg.id).status == "uncertain" and queued == []


def test_recipient_edit_invalidates_review(client, account):
    r = recipient(client, account)
    c = campaign(client, account, [r["id"]])
    preflight(client, account, c)
    response = client.put(
        "/api/v1/recipients/" + r["id"],
        headers=account,
        json={"email": r["email"], "name": "Updated", "company": "Example", "position": "Director"},
    )
    assert response.status_code == 200
    detail = client.get("/api/v1/campaigns/" + c["id"], headers=account).json()
    assert detail["revision"] == 2 and detail["reviewed_revision"] == 1


def test_role_guards_and_smtp_secret_redaction(client, account, db, monkeypatch):
    from app.models.entities import User, SMTPAccount
    from app.security.auth import decrypt
    from app.integrations import smtp

    monkeypatch.setattr(smtp, "validate_host", lambda host: None)
    result = client.post(
        "/api/v1/smtp/accounts",
        headers=account,
        json={
            "name": "Private sender",
            "host": "smtp.example.com",
            "port": 587,
            "security": "starttls",
            "username": "sender",
            "password": "super-secret-test-app-password",
            "from_email": "sender@example.com",
        },
    )
    assert result.status_code == 201, result.text
    assert "password" not in result.text
    record = db.get(SMTPAccount, result.json()["id"])
    assert record.encrypted_password != "super-secret-test-app-password"
    assert decrypt(record.encrypted_password) == "super-secret-test-app-password"
    assert "super-secret" not in client.get("/api/v1/smtp/accounts", headers=account).text
    user = db.scalar(select(User))
    user.role = "viewer"
    db.commit()
    assert (
        client.post(
            "/api/v1/recipients", headers=account, json={"email": "denied@example.com", "name": "Denied"}
        ).status_code
        == 403
    )
    assert client.get("/api/v1/audit-logs", headers=account).status_code == 403
    assert client.get("/api/v1/analytics/overview", headers=account).status_code == 200
