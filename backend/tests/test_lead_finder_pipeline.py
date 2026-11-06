from sqlalchemy import select

from app.lead_finder import brief as brief_module
from app.lead_finder.brief import build_search_queries, parse_lead_brief
from app.lead_finder.pipeline import run_lead_batch
from app.lead_finder.schemas import LeadBrief
from app.lead_finder.search import LeadSearchConfigError, SearchHit
from app.models.entities import LeadCandidate, LeadSearchRun, Recipient, Suppression, User

PAGE = "Jane Doe, Technical Recruiter, jane.doe@acme.test"


def _make_run(db, brief=None, status="queued"):
    user = db.scalars(select(User)).first()
    brief = brief or LeadBrief(target_count=5)
    run = LeadSearchRun(
        organization_id=user.organization_id,
        created_by_user_id=user.id,
        instruction="find recruiters",
        brief=brief.model_dump(),
        status=status,
        target_count=brief.target_count,
    )
    db.add(run)
    db.commit()
    return run, user


def _mock_web(monkeypatch, page=PAGE, hits=None):
    hits = hits or [SearchHit("Acme Team", "https://acme.test/team", "Jane Recruiter")]
    monkeypatch.setattr("app.lead_finder.pipeline.search_web", lambda q, num=10, start=0: hits)
    monkeypatch.setattr("app.lead_finder.pipeline.fetch_page_text", lambda url: page)


def _rows(db, run):
    return db.scalars(select(LeadCandidate).where(LeadCandidate.run_id == run.id)).all()


def test_run_lead_batch_upserts_candidates(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(monkeypatch)
    summary = run_lead_batch(db, run.id, batch_limit=20)
    db.refresh(run)
    assert run.status == "ready"
    assert summary["kept"] >= 1
    assert any(r.email == "jane.doe@acme.test" for r in _rows(db, run))
    assert run.progress["candidates_kept"] >= 1
    assert run.progress["pages_fetched"] >= 1
    assert run.progress["queries_done"] >= 1


def test_rerun_dedupes_by_email(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(monkeypatch)
    run_lead_batch(db, run.id, batch_limit=20)
    run_lead_batch(db, run.id, batch_limit=20)
    assert len([r for r in _rows(db, run) if r.email == "jane.doe@acme.test"]) == 1


def test_emails_stored_lowercase(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(monkeypatch, page="Jane Doe, Technical Recruiter, Jane.Doe@ACME.test")
    run_lead_batch(db, run.id, batch_limit=20)
    emails = [r.email for r in _rows(db, run)]
    assert emails and all(e == e.lower() for e in emails)


def test_higher_score_updates_existing_candidate(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(
        monkeypatch,
        page="Contact Jane Doe at jane.doe@acme.test",
        hits=[SearchHit("Acme Team", "https://acme.test/team", "")],
    )
    run_lead_batch(db, run.id, batch_limit=20)
    before = next(r for r in _rows(db, run) if r.email == "jane.doe@acme.test")
    assert before.score == 0
    assert before.selected is False
    _mock_web(monkeypatch, page=PAGE, hits=[SearchHit("Careers", "https://acme.test/careers", "")])
    run_lead_batch(db, run.id, batch_limit=20)
    db.expire_all()
    after = next(r for r in _rows(db, run) if r.email == "jane.doe@acme.test")
    assert after.score > 0
    assert after.selected is False  # preserved on update, not re-derived from the draft
    assert after.source_url == "https://acme.test/careers"


def test_update_preserves_user_patched_selected(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(
        monkeypatch,
        page="Contact Jane Doe at jane.doe@acme.test",
        hits=[SearchHit("Acme Team", "https://acme.test/team", "")],
    )
    run_lead_batch(db, run.id, batch_limit=20)
    row = next(r for r in _rows(db, run) if r.email == "jane.doe@acme.test")
    row.selected = True  # user patched
    db.commit()
    _mock_web(monkeypatch, page=PAGE, hits=[SearchHit("Careers", "https://acme.test/careers", "")])
    run_lead_batch(db, run.id, batch_limit=20)
    db.expire_all()
    after = next(r for r in _rows(db, run) if r.email == "jane.doe@acme.test")
    assert after.score > 0 and after.selected is True


def test_unexpected_error_marks_failed_not_running(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr("app.lead_finder.pipeline.extract_candidates_from_text", boom)
    summary = run_lead_batch(db, run.id, batch_limit=20)
    db.refresh(run)
    assert run.status == "failed" and summary["status"] == "failed"
    assert "kaboom" in run.error


def test_bad_brief_marks_failed_not_running(db, account):
    run, _ = _make_run(db)
    run.brief = {"target_count": "not-a-number", "roles": 5}
    db.commit()
    run_lead_batch(db, run.id, batch_limit=20)
    db.refresh(run)
    assert run.status == "failed"
    assert run.error


def test_continue_requests_deeper_results_and_accumulates(db, account, monkeypatch):
    run, _ = _make_run(db, brief=LeadBrief(target_count=50))
    calls = []

    def search(q, num=10, start=0):
        calls.append((q, start))
        return [SearchHit("T", f"https://acme.test/p{len(calls)}", "")]

    monkeypatch.setattr("app.lead_finder.pipeline.search_web", search)
    monkeypatch.setattr("app.lead_finder.pipeline.fetch_page_text", lambda url: PAGE)
    run_lead_batch(db, run.id, batch_limit=50)
    db.refresh(run)
    first = len(calls)
    assert {s for _, s in calls} == {0}
    assert run.progress["queries_done"] == first
    run_lead_batch(db, run.id, batch_limit=50)
    db.refresh(run)
    assert any(s > 0 for _, s in calls[first:])
    assert run.progress["queries_done"] == len(calls) > first
    assert run.progress["pages_fetched"] == len(calls)
    assert run.progress["search_page"] >= 1


def test_seen_urls_skipped_on_continue(db, account, monkeypatch):
    run, _ = _make_run(db, brief=LeadBrief(target_count=50))
    _mock_web(monkeypatch)
    fetched = []
    monkeypatch.setattr(
        "app.lead_finder.pipeline.fetch_page_text", lambda url: fetched.append(url) or PAGE
    )
    run_lead_batch(db, run.id, batch_limit=50)
    run_lead_batch(db, run.id, batch_limit=50)
    assert fetched == ["https://acme.test/team"]
    db.refresh(run)
    assert run.progress["seen_urls"] == ["https://acme.test/team"]


def test_batch_capped_by_remaining_target(db, account, monkeypatch):
    run, _ = _make_run(db, brief=LeadBrief(target_count=1))
    _mock_web(monkeypatch)
    run_lead_batch(db, run.id, batch_limit=20)
    called = []
    monkeypatch.setattr(
        "app.lead_finder.pipeline.search_web",
        lambda q, num=10, start=0: called.append(q) or [],
    )
    run_lead_batch(db, run.id, batch_limit=20)  # target already met -> no searching
    assert called == []


def test_zero_results_message_has_tip(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(monkeypatch, page=None)
    run_lead_batch(db, run.id, batch_limit=20)
    db.refresh(run)
    assert "Try broadening location or role." in run.progress["message"]


def test_every_query_has_recruiting_term():
    queries = build_search_queries(LeadBrief(roles=["hiring manager"], location="Berlin"))
    assert queries and all(
        "recruit" in q.lower() or "talent acquisition" in q.lower() for q in queries
    )


def test_lower_score_does_not_overwrite(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(monkeypatch)
    run_lead_batch(db, run.id, batch_limit=20)
    _mock_web(
        monkeypatch,
        page="Contact Jane Doe at jane.doe@acme.test",
        hits=[SearchHit("Other", "https://other.test/x", "")],
    )
    run_lead_batch(db, run.id, batch_limit=20)
    db.expire_all()
    row = next(r for r in _rows(db, run) if r.email == "jane.doe@acme.test")
    assert row.score > 0
    assert row.source_url == "https://acme.test/team"


def test_existing_recipient_skipped_not_shown(db, account, monkeypatch):
    run, user = _make_run(db)
    db.add(
        Recipient(organization_id=user.organization_id, email="jane.doe@acme.test", name="Jane")
    )
    db.commit()
    _mock_web(monkeypatch)
    run_lead_batch(db, run.id, batch_limit=20)
    assert all(r.email != "jane.doe@acme.test" for r in _rows(db, run))


def test_deleted_recipient_can_appear_again(db, account, monkeypatch):
    run, user = _make_run(db)
    db.add(
        Recipient(organization_id=user.organization_id, email="jane.doe@acme.test", deleted=True)
    )
    db.commit()
    _mock_web(monkeypatch)
    run_lead_batch(db, run.id, batch_limit=20)
    row = next(r for r in _rows(db, run) if r.email == "jane.doe@acme.test")
    assert row.existing_recipient_id is None


def test_suppressed_email_skipped_not_shown(db, account, monkeypatch):
    run, user = _make_run(db)
    db.add(Suppression(organization_id=user.organization_id, email="jane.doe@acme.test", reason="x"))
    db.commit()
    _mock_web(monkeypatch)
    summary = run_lead_batch(db, run.id, batch_limit=20)
    assert all(r.email != "jane.doe@acme.test" for r in _rows(db, run))
    assert summary["suppressed"] >= 1


def test_suppression_from_other_org_ignored(db, account, monkeypatch):
    run, _ = _make_run(db)
    from app.models.entities import Organization

    other = Organization(name="Other")
    db.add(other)
    db.flush()
    db.add(Suppression(organization_id=other.id, email="jane.doe@acme.test", reason="x"))
    db.commit()
    _mock_web(monkeypatch)
    run_lead_batch(db, run.id, batch_limit=20)
    row = next(r for r in _rows(db, run) if r.email == "jane.doe@acme.test")
    assert row.selected is True
    assert not row.signals.get("suppressed")


def test_cancelled_run_returns_early(db, account, monkeypatch):
    run, _ = _make_run(db, status="cancelled")
    called = []
    monkeypatch.setattr(
        "app.lead_finder.pipeline.search_web", lambda q, num=10, start=0: called.append(q) or []
    )
    summary = run_lead_batch(db, run.id, batch_limit=20)
    db.refresh(run)
    assert run.status == "cancelled"
    assert called == []
    assert summary["kept"] == 0


def test_config_error_marks_failed(db, account, monkeypatch):
    run, _ = _make_run(db)

    def boom(q, num=10, start=0):
        raise LeadSearchConfigError("Configure SERPER_API_KEY")

    monkeypatch.setattr("app.lead_finder.pipeline.search_web", boom)
    run_lead_batch(db, run.id, batch_limit=20)
    db.refresh(run)
    assert run.status == "failed"
    assert "SERPER_API_KEY" in run.error


def test_partial_provider_error_sets_warning(db, account, monkeypatch):
    run, _ = _make_run(db)
    calls = {"n": 0}

    def flaky(q, num=10, start=0):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("provider down")
        return [SearchHit("Acme Team", "https://acme.test/team", "Jane")]

    monkeypatch.setattr("app.lead_finder.pipeline.search_web", flaky)
    monkeypatch.setattr("app.lead_finder.pipeline.fetch_page_text", lambda url: PAGE)
    run_lead_batch(db, run.id, batch_limit=20)
    db.refresh(run)
    assert run.status == "ready"
    assert run.progress.get("warning")
    assert run.progress["candidates_kept"] >= 1


def test_zero_candidates_still_ready(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(monkeypatch, page=None)
    summary = run_lead_batch(db, run.id, batch_limit=20)
    db.refresh(run)
    assert run.status == "ready"
    assert summary["kept"] == 0


def test_batch_limit_stops_early(db, account, monkeypatch):
    run, _ = _make_run(db)
    queries = []

    def search(q, num=10, start=0):
        queries.append(q)
        return [SearchHit("Acme Team", "https://acme.test/team", "")]

    monkeypatch.setattr("app.lead_finder.pipeline.search_web", search)
    monkeypatch.setattr("app.lead_finder.pipeline.fetch_page_text", lambda url: PAGE)
    run_lead_batch(db, run.id, batch_limit=1)
    assert len(queries) == 1


def test_build_search_queries_biases_recruiter_and_public_pages():
    queries = build_search_queries(
        LeadBrief(roles=["data recruiter"], location="Berlin", industry="fintech", keywords=["python"])
    )
    assert 3 <= len(queries) <= 6
    joined = " ".join(queries).lower()
    assert "recruiter" in joined and "talent acquisition" in joined
    assert "berlin" in joined and "fintech" in joined
    assert any(w in joined for w in ("team", "about", "careers"))
    assert "linkedin" not in joined.replace("-site:linkedin.com", "")


def test_build_search_queries_defaults_recruiter_terms_when_roles_empty():
    queries = build_search_queries(LeadBrief(roles=[]))
    assert "recruiter" in " ".join(queries).lower()


def test_parse_fallback_when_llm_unavailable(monkeypatch):
    def fail(*a, **k):
        raise ValueError("no key")

    monkeypatch.setattr(brief_module, "invoke_structured", fail)
    b = parse_lead_brief("Find 30 recruiters in fintech")
    assert b.target_count == 30
    assert b.roles == ["recruiter", "talent acquisition"]
    assert b.location == "" and b.keywords == [] and b.industry == ""


def test_parse_fallback_override_and_clamp(monkeypatch):
    def fail(*a, **k):
        raise ValueError("no key")

    monkeypatch.setattr(brief_module, "invoke_structured", fail)
    assert parse_lead_brief("find 30 recruiters", target_count_override=7).target_count == 7
    assert parse_lead_brief("find 5000 recruiters").target_count == 100
    assert parse_lead_brief("find recruiters", target_count_override=0).target_count == 1
    assert parse_lead_brief("find recruiters").target_count >= 1


def test_parse_uses_llm_and_clamps(monkeypatch):
    seen = {}

    def fake(schema, messages):
        seen["schema"] = schema
        return schema(
            roles=["technical recruiter"], location="Berlin", target_count=500, industry="saas"
        )

    monkeypatch.setattr(brief_module, "invoke_structured", fake)
    b = parse_lead_brief("recruiters in Berlin")
    assert b.roles == ["technical recruiter"] and b.location == "Berlin"
    assert b.target_count == 100
    assert parse_lead_brief("recruiters in Berlin", target_count_override=12).target_count == 12


def test_parse_llm_empty_roles_defaulted(monkeypatch):
    monkeypatch.setattr(
        brief_module, "invoke_structured", lambda schema, messages: schema(roles=[], target_count=10)
    )
    assert parse_lead_brief("x").roles == ["recruiter", "talent acquisition"]


def test_stale_generation_exits_without_writing(db, account, monkeypatch):
    run, _ = _make_run(db)
    run.progress = {"batch_generation": 2}
    db.commit()
    called = []
    monkeypatch.setattr(
        "app.lead_finder.pipeline.search_web", lambda q, num=10, start=0: called.append(q) or []
    )
    summary = run_lead_batch(db, run.id, batch_limit=20, generation=1)
    db.refresh(run)
    assert called == [] and run.status == "queued" and summary["kept"] == 0
    assert run.progress == {"batch_generation": 2}


def test_generation_bumped_mid_batch_aborts_old_worker(db, account, monkeypatch):
    from app.database.session import SessionLocal

    run, _ = _make_run(db, brief=LeadBrief(target_count=50))
    run.progress = {"batch_generation": 1}
    db.commit()
    calls = []

    def search(q, num=10, start=0):
        calls.append(q)
        if len(calls) == 1:  # a "continue" re-enqueues while this worker is mid-batch
            with SessionLocal() as other:
                fresh = other.get(LeadSearchRun, run.id)
                fresh.status = "queued"
                fresh.progress = {**fresh.progress, "batch_generation": 2}
                other.commit()
        return [SearchHit("T", f"https://acme.test/p{len(calls)}", "")]

    monkeypatch.setattr("app.lead_finder.pipeline.search_web", search)
    monkeypatch.setattr("app.lead_finder.pipeline.fetch_page_text", lambda url: PAGE)
    run_lead_batch(db, run.id, batch_limit=50, generation=1)
    db.expire_all()
    db.refresh(run)
    assert len(calls) == 1
    assert run.status == "queued" and run.progress["batch_generation"] == 2


def test_fail_does_not_overwrite_cancelled(db, account, monkeypatch):
    from app.database.session import SessionLocal

    run, _ = _make_run(db)
    _mock_web(monkeypatch)

    def cancel_then_boom(*a, **k):
        with SessionLocal() as other:
            other.get(LeadSearchRun, run.id).status = "cancelled"
            other.commit()
        raise RuntimeError("kaboom")

    monkeypatch.setattr("app.lead_finder.pipeline.extract_candidates_from_text", cancel_then_boom)
    summary = run_lead_batch(db, run.id, batch_limit=20)
    db.expire_all()
    db.refresh(run)
    assert run.status == "cancelled" and summary["status"] == "cancelled"
    assert run.error is None


def test_user_edited_fields_survive_better_resighting(db, account, monkeypatch):
    run, _ = _make_run(db)
    _mock_web(
        monkeypatch,
        page="Contact Jane Doe at jane.doe@acme.test",
        hits=[SearchHit("Acme Team", "https://acme.test/team", "")],
    )
    run_lead_batch(db, run.id, batch_limit=20)
    row = next(r for r in _rows(db, run) if r.email == "jane.doe@acme.test")
    row.name, row.company = "Jane Q. Doe", "Acme Corp"
    row.signals = {**(row.signals or {}), "user_edited": ["company", "name"]}
    db.commit()
    _mock_web(monkeypatch, page=PAGE, hits=[SearchHit("Careers", "https://acme.test/careers", "")])
    run_lead_batch(db, run.id, batch_limit=20)
    db.expire_all()
    after = next(r for r in _rows(db, run) if r.email == "jane.doe@acme.test")
    assert after.score > 0 and after.source_url == "https://acme.test/careers"
    assert (after.name, after.company) == ("Jane Q. Doe", "Acme Corp")
    assert after.signals["user_edited"] == ["company", "name"]


def test_upserts_stop_at_goal_no_overshoot(db, account, monkeypatch):
    run, _ = _make_run(db, brief=LeadBrief(target_count=2))
    page = " ".join(
        f"Person{i} Doe, Technical Recruiter, person{i}@acme.test." for i in range(6)
    )
    _mock_web(monkeypatch, page=page)
    summary = run_lead_batch(db, run.id, batch_limit=20)
    assert summary["kept"] == 2 and len(_rows(db, run)) == 2
