"""Exercise real HTTP + PostgreSQL + Redis + Celery without sending email."""

import json
import secrets
import time
from pathlib import Path

import httpx

root = Path(__file__).resolve().parents[1]
base = "http://127.0.0.1:8000/api/v1"
with httpx.Client(timeout=20) as client:
    identity = {
        "email": f"smoke-{secrets.token_hex(5)}@example.com",
        "password": secrets.token_urlsafe(24),
        "name": "Integration verification",
        "organization": "Smoke-test workspace",
    }
    response = client.post(base + "/auth/register", json=identity)
    response.raise_for_status()
    headers = {"Authorization": "Bearer " + response.json()["access_token"]}
    client.headers.update(headers)
    uploaded = client.post(
        base + "/documents/upload",
        files={
            "file": (
                "smoke-contacts.csv",
                b"email,name,company\nreview@example.com,Review Contact,Example\nreview@example.com,Review Contact,Example\n",
                "text/csv",
            )
        },
    )
    uploaded.raise_for_status()
    doc = uploaded.json()
    queued = client.post(base + f"/documents/{doc['id']}/extract")
    queued.raise_for_status()
    for _ in range(30):
        extracted = client.get(base + f"/documents/{doc['id']}/recipients").json()
        if extracted["status"] in ("completed", "failed"):
            break
        time.sleep(1)
    assert extracted["status"] == "completed", extracted
    assert len(extracted["records"]) == 1 and extracted["duplicates"] == 1
    recipient = client.post(base + "/recipients", json=extracted["records"][0])
    recipient.raise_for_status()
    r = recipient.json()
    client.post(
        base + f"/recipients/{r['id']}/consent",
        json={
            "granted": True,
            "source": "Synthetic integration test contact; no live delivery permitted",
        },
    ).raise_for_status()
    created = client.post(
        base + "/campaigns",
        json={
            "name": "Verified dry-run workflow",
            "subject": "Hello {{name}}",
            "body": "<p>Hello {{name}} at {{company}}.</p>",
            "recipient_ids": [r["id"]],
        },
    )
    created.raise_for_status()
    campaign = created.json()
    path = base + "/campaigns/" + campaign["id"]
    client.post(
        path + "/review", json={"revision": 1, "confirm": True}
    ).raise_for_status()
    dry = client.post(path + "/dry-run")
    dry.raise_for_status()
    assert dry.json()["sent"] == 0
    approval = client.post(path + "/approve", json={"revision": 1, "confirm": True})
    assert approval.status_code == 409
    metrics = client.get(base + "/analytics/overview")
    metrics.raise_for_status()
    assert metrics.json()["smtp_accepted"] == 0
    for path in [
        "/campaigns",
        "/emails",
        "/recipients",
        "/templates",
        "/settings",
        "/analytics/emails",
        "/analytics/campaigns",
        "/audit-logs",
        "/agents/executions",
    ]:
        client.get(base + path).raise_for_status()
    private = root / ".local/smoke-account.json"
    private.write_text(json.dumps(identity))
    private.chmod(0o600)
print(
    "PASS: real HTTP upload → Celery extraction → deduplication → reviewed recipient → campaign → dry-run → production blocked. No email sent."
)
