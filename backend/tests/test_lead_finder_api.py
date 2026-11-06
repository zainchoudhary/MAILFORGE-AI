import pytest
from sqlalchemy import select

from app.lead_finder.schemas import LeadBrief
from app.models.entities import (
    AuditLog,
    GroupMember,
    LeadCandidate,
    LeadSearchRun,
    Recipient,
    RecipientGroup,
    Suppression,
    User,
)

BASE = "/api/v1/lead-finder"


def _run(db, status="ready", target=25, org=None, user=None):
    user = user or db.scalars(select(User)).first()
    run = LeadSearchRun(
        organization_id=org or user.organization_id,
        created_by_user_id=user.id,
        instruction="find recruiters",
        brief=LeadBrief(target_count=target).model_dump(),
        status=status,
        target_count=target,
        progress={},
    )
    db.add(run)
    db.commit()
    return run


def _cand(db, run, email, selected=True, **kw):
    item = LeadCandidate(
        organization_id=run.organization_id,
        run_id=run.id,
        email=email,
        selected=selected,
        source_url=kw.pop("source_url", "https://acme.test/team"),
        **kw,
    )
    db.add(item)
    db.commit()
    return item


def test_create_run_returns_immediately(client, account, monkeypatch):
    enqueued = []
    monkeypatch.setattr(
        "app.lead_finder.service.parse_lead_brief",
        lambda instruction, target_count_override=None: LeadBrief(
            roles=["recruiter"], location="London", target_count=target_count_override or 25
        ),
    )
    monkeypatch.setattr("app.lead_finder.service.enqueue_or_run", lambda run_id, **kw: enqueued.append(run_id))
    res = client.post(
        f"{BASE}/runs",
        headers=account,
        json={"instruction": "Find 25 recruiters in London", "target_count": 25},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] in ("queued", "running")
    assert body["target_count"] == 25
    assert "id" in body
    assert enqueued == [body["id"]]
    assert body["brief"]["location"] == "London"
    listing = client.get(f"{BASE}/runs", headers=account).json()["items"]
    assert [r["id"] for r in listing] == [body["id"]]
    assert client.get(f"{BASE}/runs/{body['id']}", headers=account).json()["id"] == body["id"]


def test_create_run_requires_auth_and_valid_body(client, account):
    assert client.post(f"{BASE}/runs", json={"instruction": "abc"}).status_code in (401, 403)
    res = client.post(f"{BASE}/runs", headers=account, json={"instruction": "x"})
    assert res.status_code == 422


def test_save_group_creates_recipients_and_group(client, account, db):
    run = _run(db)
    _cand(db, run, "a@acme.test", name="Ann", company="Acme", position="Recruiter")
    _cand(db, run, "b@acme.test", name="Bob")
    _cand(db, run, "c@acme.test", selected=False, name="Cy")
    res = client.post(
        f"{BASE}/runs/{run.id}/save-group", headers=account, json={"group_name": "London Recruiters"}
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["created"] == 2
    assert data["reused"] == 0
    assert data["skipped"] == 0
    assert data["group_name"] == "London Recruiters"
    groups = client.get("/api/v1/recipient-groups", headers=account).json()["items"]
    group = next(g for g in groups if g["name"] == "London Recruiters")
    assert group["recipient_count"] == 2
    db.expire_all()
    recipient = db.scalar(select(Recipient).where(Recipient.email == "a@acme.test"))
    assert recipient.custom_fields["lead_source_url"] == "https://acme.test/team"
    assert recipient.company == "Acme"
    actions = {a.action for a in db.scalars(select(AuditLog))}
    assert {"recipient_group.created", "lead_finder.group_saved"} <= actions


def test_save_group_single_member_allowed(client, account, db):
    run = _run(db)
    _cand(db, run, "solo@acme.test", name="Solo")
    res = client.post(f"{BASE}/runs/{run.id}/save-group", headers=account, json={"group_name": "Solo"})
    assert res.status_code == 201
    assert res.json()["created"] == 1


def test_save_group_reuses_existing_and_skips_suppressed(client, account, db):
    run = _run(db)
    user = db.scalars(select(User)).first()
    db.add(Recipient(organization_id=user.organization_id, email="old@acme.test", name="Old"))
    db.add(Suppression(organization_id=user.organization_id, email="stop@acme.test", reason="x"))
    db.commit()
    _cand(db, run, "old@acme.test", name="Old")
    _cand(db, run, "stop@acme.test", name="Stop")
    _cand(db, run, "new@acme.test", name="New")
    res = client.post(f"{BASE}/runs/{run.id}/save-group", headers=account, json={"group_name": "Mix"})
    assert res.status_code == 201
    data = res.json()
    assert (data["created"], data["reused"], data["skipped"]) == (1, 1, 1)
    db.expire_all()
    members = db.scalars(select(GroupMember).where(GroupMember.group_id == data["group_id"])).all()
    assert len(members) == 2
    assert db.scalar(select(Recipient).where(Recipient.email == "stop@acme.test")) is None


def test_save_group_explicit_candidate_ids(client, account, db):
    run = _run(db)
    a = _cand(db, run, "a@acme.test", selected=False, name="A")
    _cand(db, run, "b@acme.test", selected=True, name="B")
    res = client.post(
        f"{BASE}/runs/{run.id}/save-group",
        headers=account,
        json={"group_name": "Picked", "candidate_ids": [a.id]},
    )
    assert res.status_code == 201
    assert res.json()["created"] == 1
    other = client.post(
        f"{BASE}/runs/{run.id}/save-group",
        headers=account,
        json={"group_name": "Bad", "candidate_ids": ["nope"]},
    )
    assert other.status_code == 422


def test_save_group_empty_selection_422(client, account, db):
    run = _run(db)
    _cand(db, run, "a@acme.test", selected=False, name="A")
    res = client.post(f"{BASE}/runs/{run.id}/save-group", headers=account, json={"group_name": "Empty"})
    assert res.status_code == 422


def test_save_group_duplicate_name_409(client, account, db):
    user = db.scalars(select(User)).first()
    db.add(RecipientGroup(organization_id=user.organization_id, name="Dup"))
    db.commit()
    run = _run(db)
    _cand(db, run, "a@acme.test", name="A")
    res = client.post(f"{BASE}/runs/{run.id}/save-group", headers=account, json={"group_name": "Dup"})
    assert res.status_code == 409
    db.expire_all()
    assert db.scalar(select(Recipient).where(Recipient.email == "a@acme.test")) is None


def test_candidates_list_and_patch(client, account, db):
    run = _run(db)
    c1 = _cand(db, run, "a@acme.test", name="A", score=2)
    c2 = _cand(db, run, "b@acme.test", name="B", score=1)
    items = client.get(f"{BASE}/runs/{run.id}/candidates", headers=account).json()["items"]
    assert [i["email"] for i in items] == ["a@acme.test", "b@acme.test"]
    res = client.patch(
        f"{BASE}/runs/{run.id}/candidates/{c1.id}",
        headers=account,
        json={"email": " New@Acme.TEST ", "company": "NewCo", "selected": False},
    )
    assert res.status_code == 200, res.text
    assert res.json()["email"] == "new@acme.test"
    assert res.json()["company"] == "NewCo"
    assert res.json()["selected"] is False
    dup = client.patch(
        f"{BASE}/runs/{run.id}/candidates/{c2.id}", headers=account, json={"email": "NEW@acme.test"}
    )
    assert dup.status_code == 409
    bad = client.patch(f"{BASE}/runs/{run.id}/candidates/{c2.id}", headers=account, json={"email": "nope"})
    assert bad.status_code == 422


def test_bulk_candidates_selection(client, account, db):
    run = _run(db)
    a = _cand(db, run, "a@acme.test", selected=True, name="A")
    b = _cand(db, run, "b@acme.test", selected=True, name="B")
    c = _cand(db, run, "c@acme.test", selected=False, name="C")
    clear = client.post(
        f"{BASE}/runs/{run.id}/candidates/selection",
        headers=account,
        json={"selected": False, "candidate_ids": [a.id, b.id, c.id]},
    )
    assert clear.status_code == 200, clear.text
    assert clear.json()["updated"] == 2
    assert clear.json()["selected"] is False
    db.expire_all()
    assert not db.get(LeadCandidate, a.id).selected
    assert not db.get(LeadCandidate, b.id).selected
    assert not db.get(LeadCandidate, c.id).selected
    select_all = client.post(
        f"{BASE}/runs/{run.id}/candidates/selection",
        headers=account,
        json={"selected": True, "candidate_ids": [a.id, b.id, c.id]},
    )
    assert select_all.status_code == 200
    assert select_all.json()["updated"] == 3
    missing = client.post(
        f"{BASE}/runs/{run.id}/candidates/selection",
        headers=account,
        json={"selected": True, "candidate_ids": [a.id, "00000000-0000-0000-0000-000000000000"]},
    )
    assert missing.status_code == 404


def test_patch_candidate_wrong_run_404(client, account, db):
    run, other = _run(db), _run(db)
    cand = _cand(db, other, "a@acme.test", name="A")
    res = client.patch(
        f"{BASE}/runs/{run.id}/candidates/{cand.id}", headers=account, json={"selected": False}
    )
    assert res.status_code == 404


def test_runs_are_tenant_scoped(client, account, db):
    other_client_headers = client.post(
        "/api/v1/auth/register",
        json={"email": "x@other.com", "password": "Strong-test1!", "name": "X", "organization": "Other"},
    ).json()
    headers = {"Authorization": "Bearer " + other_client_headers["access_token"]}
    run = _run(db)
    assert client.get(f"{BASE}/runs/{run.id}", headers=headers).status_code == 404
    assert client.get(f"{BASE}/runs", headers=headers).json()["items"] == []
    assert client.post(f"{BASE}/runs/{run.id}/cancel", headers=headers).status_code == 404


def test_cancel_run(client, account, db):
    run = _run(db, status="running")
    res = client.post(f"{BASE}/runs/{run.id}/cancel", headers=account)
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"
    done = _run(db, status="ready")
    assert client.post(f"{BASE}/runs/{done.id}/cancel", headers=account).status_code == 409


def test_continue_run_enqueues_remaining(client, account, db, monkeypatch):
    calls = []
    monkeypatch.setattr(
        "app.lead_finder.service.enqueue_or_run", lambda run_id, batch_limit=None, generation=None: calls.append((run_id, batch_limit, generation))
    )
    run = _run(db, status="ready", target=30)
    for i in range(25):
        _cand(db, run, f"p{i}@acme.test", name="P")
    res = client.post(f"{BASE}/runs/{run.id}/continue", headers=account)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "queued"
    assert calls == [(run.id, 5, 1)]
    assert res.json()["progress"]["batch_generation"] == 1
    # queued runs cannot be continued again
    assert client.post(f"{BASE}/runs/{run.id}/continue", headers=account).status_code == 409


def test_continue_run_at_target_extends_target(client, account, db, monkeypatch):
    calls = []
    monkeypatch.setattr(
        "app.lead_finder.service.enqueue_or_run", lambda run_id, batch_limit=None, generation=None: calls.append((run_id, batch_limit, generation))
    )
    run = _run(db, status="ready", target=2)
    _cand(db, run, "a@acme.test", name="A")
    _cand(db, run, "b@acme.test", name="B")
    res = client.post(f"{BASE}/runs/{run.id}/continue", headers=account)
    assert res.status_code == 200
    assert res.json()["target_count"] == 22
    assert calls == [(run.id, 20, 1)]


def test_continue_failed_run_409(client, account, db):
    run = _run(db, status="failed")
    assert client.post(f"{BASE}/runs/{run.id}/continue", headers=account).status_code == 409


def test_viewer_can_read_but_not_mutate(client, account, db):
    user = db.scalars(select(User)).first()
    run = _run(db)
    user.role = "viewer"
    db.commit()
    assert client.get(f"{BASE}/runs", headers=account).status_code == 200
    assert client.post(f"{BASE}/runs/{run.id}/cancel", headers=account).status_code == 403
    assert client.post(f"{BASE}/runs", headers=account, json={"instruction": "find recruiters"}).status_code == 403


def test_enqueue_or_run_uses_celery_and_never_inlines_with_broker(db, account, monkeypatch):
    from app.core.config import get_settings
    from app.lead_finder import service

    run = _run(db, status="queued")
    run.progress = {"batch_generation": 3}
    db.commit()
    sent = []
    monkeypatch.setattr(
        "app.workers.tasks.run_lead_finder_batch.delay",
        lambda run_id, batch_limit=20, generation=None: sent.append((run_id, batch_limit, generation)),
    )
    inline = []
    monkeypatch.setattr(
        service, "run_lead_batch", lambda db, run_id, batch_limit, generation=None: inline.append(run_id)
    )
    service.enqueue_or_run(run.id, batch_limit=7, generation=3)
    assert sent == [(run.id, 7, 3)] and inline == []

    def boom(*a, **k):
        raise RuntimeError("broker down")

    monkeypatch.setattr("app.workers.tasks.run_lead_finder_batch.delay", boom)
    service.enqueue_or_run(run.id, batch_limit=3, generation=3)
    assert inline == []  # never runs the batch inside the HTTP request
    db.expire_all()
    db.refresh(run)
    assert run.status == "failed"
    assert run.error == service.WORKER_UNAVAILABLE
    assert run.progress["message"] == service.WORKER_UNAVAILABLE

    monkeypatch.setattr(get_settings(), "redis_url", "")
    service.enqueue_or_run("r3")
    assert inline == ["r3"]


def test_schedule_next_batch_continues_until_target(db, account, monkeypatch):
    from app.lead_finder import service

    run = _run(db, status="ready", target=50)
    run.progress = {"batch_generation": 1, "auto_batches": 0}
    for i in range(20):
        _cand(db, run, f"n{i}@acme.test", name="N")
    db.commit()
    calls = []
    monkeypatch.setattr(
        "app.lead_finder.service.enqueue_or_run",
        lambda run_id, batch_limit=None, generation=None: calls.append((run_id, batch_limit, generation)),
    )
    service.schedule_next_batch_if_needed(run.id, kept_before=0, generation=1)
    db.refresh(run)
    assert run.status == "queued"
    assert calls == [(run.id, 20, 2)]  # remaining 30, chunked to first_batch 20
    assert run.progress["auto_batches"] == 1
    assert "Continuing toward 50" in run.progress["message"]


def test_schedule_next_batch_stops_when_stalled(db, account, monkeypatch):
    from app.lead_finder import service

    run = _run(db, status="ready", target=50)
    run.progress = {"batch_generation": 1}
    for i in range(12):
        _cand(db, run, f"s{i}@acme.test", name="S")
    db.commit()
    calls = []
    monkeypatch.setattr(
        "app.lead_finder.service.enqueue_or_run",
        lambda run_id, batch_limit=None, generation=None: calls.append(run_id),
    )
    service.schedule_next_batch_if_needed(run.id, kept_before=12, generation=1)
    db.refresh(run)
    assert calls == []
    assert run.status == "ready"
    assert "no more new leads" in run.progress["message"]


def test_create_run_with_broker_down_returns_failed(client, account, monkeypatch):
    monkeypatch.setattr(
        "app.lead_finder.service.parse_lead_brief",
        lambda instruction, target_count_override=None: LeadBrief(target_count=5),
    )

    def boom(*a, **k):
        raise RuntimeError("broker down")

    monkeypatch.setattr("app.workers.tasks.run_lead_finder_batch.delay", boom)
    monkeypatch.setattr(
        "app.lead_finder.service.run_lead_batch", lambda *a, **k: pytest.fail("ran inline")
    )
    res = client.post(f"{BASE}/runs", headers=account, json={"instruction": "find recruiters"})
    assert res.status_code == 201
    assert res.json()["status"] == "failed"
    assert "worker unavailable" in res.json()["error"].lower()


def test_patch_marks_user_edited_fields(client, account, db):
    run = _run(db)
    cand = _cand(db, run, "a@acme.test", name="A", company="Acme", signals={"title_match": True})
    res = client.patch(
        f"{BASE}/runs/{run.id}/candidates/{cand.id}",
        headers=account,
        json={"name": "Ann", "company": "Acme", "selected": False},
    )
    assert res.status_code == 200
    assert res.json()["signals"] == {"title_match": True, "user_edited": ["name"]}
    res = client.patch(
        f"{BASE}/runs/{run.id}/candidates/{cand.id}", headers=account, json={"position": "TA Lead"}
    )
    assert res.json()["signals"]["user_edited"] == ["name", "position"]
    res = client.patch(
        f"{BASE}/runs/{run.id}/candidates/{cand.id}", headers=account, json={"selected": True}
    )
    assert res.json()["signals"]["user_edited"] == ["name", "position"]
