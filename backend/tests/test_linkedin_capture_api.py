import pytest

BASE = "/api/v1/linkedin-capture"


@pytest.fixture
def other_account(client):
    result = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other@example.com",
            "password": "Strong-test1!",
            "name": "Other",
            "organization": "Globex",
        },
    )
    assert result.status_code == 201, result.text
    return {"Authorization": "Bearer " + result.json()["access_token"]}


def _job(jid="111", **kw):
    return {
        "linkedin_job_id": jid,
        "title": "Engineer",
        "company": "Acme",
        "location": "NY",
        "job_url": f"https://www.linkedin.com/jobs/view/{jid}",
        "list_payload": {"snippet": "hi"},
        **kw,
    }


def _new_run(client, account):
    res = client.post(
        f"{BASE}/runs",
        headers=account,
        json={"search_url": "https://www.linkedin.com/jobs/search/?keywords=engineer"},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_create_batch_extract_and_save_group(client, account, db):
    run_id = _new_run(client, account)
    batch = client.post(
        f"{BASE}/runs/{run_id}/jobs/batch",
        headers=account,
        json={
            "jobs": [
                _job(
                    detail_payload={
                        "description": "Email careers-real@acme.test about this role."
                    }
                )
            ]
        },
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["inserted"] == 1

    cands = client.get(f"{BASE}/runs/{run_id}/candidates", headers=account)
    assert cands.status_code == 200
    rows = cands.json()["items"]
    assert any("acme.test" in (r.get("email") or "") for r in rows)

    # Explicitly select the candidate, then save.
    cid = rows[0]["id"]
    patched = client.patch(
        f"{BASE}/runs/{run_id}/candidates/{cid}", headers=account, json={"selected": True}
    )
    assert patched.status_code == 200, patched.text
    save = client.post(
        f"{BASE}/runs/{run_id}/save-group", headers=account, json={"group_name": "LI Acme Leads"}
    )
    assert save.status_code == 201, save.text
    assert save.json()["group_id"]


def test_list_get_jobs_extract_cancel_and_fetch_details(client, account):
    run_id = _new_run(client, account)
    client.post(f"{BASE}/runs/{run_id}/jobs/batch", headers=account, json={"jobs": [_job()]})

    runs = client.get(f"{BASE}/runs", headers=account)
    assert runs.status_code == 200
    assert [r["id"] for r in runs.json()["items"]] == [run_id]

    got = client.get(f"{BASE}/runs/{run_id}", headers=account)
    assert got.status_code == 200
    assert got.json()["job_count"] == 1

    jobs = client.get(f"{BASE}/runs/{run_id}/jobs", headers=account)
    assert jobs.status_code == 200
    assert len(jobs.json()["items"]) == 1

    fetch = client.post(f"{BASE}/runs/{run_id}/jobs/fetch-details", headers=account, json={})
    assert fetch.status_code == 200
    assert fetch.json()["linkedin_job_ids"] == ["111"]

    extract = client.post(f"{BASE}/runs/{run_id}/extract", headers=account, json={})
    assert extract.status_code == 200
    assert extract.json()["jobs"] == 1

    cancel = client.post(f"{BASE}/runs/{run_id}/cancel", headers=account)
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"


def test_patch_candidate_rejects_bad_email(client, account):
    run_id = _new_run(client, account)
    client.post(
        f"{BASE}/runs/{run_id}/jobs/batch",
        headers=account,
        json={"jobs": [_job(detail_payload={"description": "Email jobs@acme.test now."})]},
    )
    cid = client.get(f"{BASE}/runs/{run_id}/candidates", headers=account).json()["items"][0]["id"]
    bad = client.patch(
        f"{BASE}/runs/{run_id}/candidates/{cid}", headers=account, json={"email": "nope"}
    )
    assert bad.status_code == 422


def test_batch_respects_hard_ceiling(client, account, db, monkeypatch):
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "linkedin_capture_hard_ceiling", 2)
    monkeypatch.setattr(settings, "linkedin_capture_max_jobs_per_run", 2)
    run_id = client.post(f"{BASE}/runs", headers=account, json={}).json()["id"]
    jobs = [_job(str(i), title="T", company="C", location="") for i in range(3)]
    res = client.post(f"{BASE}/runs/{run_id}/jobs/batch", headers=account, json={"jobs": jobs})
    assert res.status_code == 422


def test_delete_run_removes_jobs_and_candidates(client, account, db):
    run_id = _new_run(client, account)
    client.post(
        f"{BASE}/runs/{run_id}/jobs/batch",
        headers=account,
        json={"jobs": [_job(detail_payload={"description": "Email wipe@acme.test now."})]},
    )
    assert client.get(f"{BASE}/runs/{run_id}/candidates", headers=account).json()["total"] >= 1

    deleted = client.delete(f"{BASE}/runs/{run_id}", headers=account)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] == 1
    assert client.get(f"{BASE}/runs/{run_id}", headers=account).status_code == 404
    listed = client.get(f"{BASE}/runs", headers=account).json()["items"]
    assert all(item["id"] != run_id for item in listed)


def test_bulk_delete_runs(client, account):
    a = _new_run(client, account)
    b = _new_run(client, account)
    res = client.post(f"{BASE}/runs/bulk-delete", headers=account, json={"run_ids": [a, b]})
    assert res.status_code == 200, res.text
    assert res.json()["deleted"] == 2
    ids = {item["id"] for item in client.get(f"{BASE}/runs", headers=account).json()["items"]}
    assert a not in ids and b not in ids


def test_requires_auth(client):
    assert client.get(f"{BASE}/runs").status_code in (401, 403)


def test_org_isolation(client, account, other_account, db):
    run_id = client.post(f"{BASE}/runs", headers=account, json={}).json()["id"]
    assert client.get(f"{BASE}/runs/{run_id}", headers=other_account).status_code == 404
    assert client.get(f"{BASE}/runs/{run_id}/candidates", headers=other_account).status_code == 404
    assert client.get(f"{BASE}/runs", headers=other_account).json()["items"] == []


def test_jobs_endpoint_filters_by_detail_status(client, account):
    run_id = _new_run(client, account)
    client.post(
        f"{BASE}/runs/{run_id}/jobs/batch",
        headers=account,
        json={"jobs": [_job("1"), _job("2", detail_payload={"description": "hello"})]},
    )
    res = client.get(f"{BASE}/runs/{run_id}/jobs?detail_status=pending", headers=account)
    assert res.status_code == 200
    assert [j["linkedin_job_id"] for j in res.json()["items"]] == ["1"]
    assert res.json()["total"] == 1
    bad = client.get(f"{BASE}/runs/{run_id}/jobs?detail_status=nope", headers=account)
    assert bad.status_code == 422


def test_cross_org_writes_are_isolated(client, account, other_account, db):
    run_id = _new_run(client, account)
    client.post(
        f"{BASE}/runs/{run_id}/jobs/batch",
        headers=account,
        json={"jobs": [_job(detail_payload={"description": "Email jobs@acme.test now."})]},
    )
    cid = client.get(f"{BASE}/runs/{run_id}/candidates", headers=account).json()["items"][0]["id"]

    batch = client.post(
        f"{BASE}/runs/{run_id}/jobs/batch", headers=other_account, json={"jobs": [_job("999")]}
    )
    assert batch.status_code == 404
    patch = client.patch(
        f"{BASE}/runs/{run_id}/candidates/{cid}", headers=other_account, json={"selected": True}
    )
    assert patch.status_code == 404
    save = client.post(
        f"{BASE}/runs/{run_id}/save-group",
        headers=other_account,
        json={"group_name": "Stolen", "candidate_ids": [cid]},
    )
    assert save.status_code == 404
    # Other org also cannot use its own run with this org's candidate id.
    other_run = _new_run(client, other_account)
    cross = client.patch(
        f"{BASE}/runs/{other_run}/candidates/{cid}", headers=other_account, json={"selected": True}
    )
    assert cross.status_code == 404

    # Owner's data untouched.
    jobs = client.get(f"{BASE}/runs/{run_id}/jobs", headers=account).json()
    assert jobs["total"] == 1
    cand = client.get(f"{BASE}/runs/{run_id}/candidates", headers=account).json()["items"][0]
    assert cand["id"] == cid
    assert client.get(f"{BASE}/runs/{run_id}", headers=account).json()["status"] != "cancelled"
