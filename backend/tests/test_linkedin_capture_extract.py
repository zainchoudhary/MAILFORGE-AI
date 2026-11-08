from app.linkedin_capture.extract import canonicalize_post_url, extract_from_job, job_text_for_extract


def test_extracts_email_from_detail_description():
    drafts = extract_from_job(
        title="Backend Engineer",
        company="Acme Corp",
        location="Remote",
        job_url="https://www.linkedin.com/jobs/view/123",
        list_payload={"snippet": "Great role"},
        detail_payload={
            "description": "Apply via hiring@acme.com or message our TA team.",
        },
    )
    assert len(drafts) == 1
    assert drafts[0].email == "hiring@acme.com"
    assert drafts[0].company  # from job company if name missing
    assert drafts[0].source_url.endswith("/123")
    assert drafts[0].signals.get("source") == "linkedin_job_post"


def test_no_email_means_empty():
    drafts = extract_from_job(
        title="Engineer",
        company="Acme",
        location="",
        job_url="https://www.linkedin.com/jobs/view/9",
        list_payload={},
        detail_payload={"description": "No contact listed. Easy Apply only."},
    )
    assert drafts == []


def test_feed_post_extracts_email_and_author():
    drafts = extract_from_job(
        title="Alex Rivera",
        company="Hiring Manager at Northwind",
        location="",
        job_url="https://www.linkedin.com/posts/alex-activity-1",
        list_payload={"kind": "post", "author": "Alex Rivera", "subtitle": "Hiring Manager at Northwind"},
        detail_payload={
            "kind": "post",
            "author": "Alex Rivera",
            "subtitle": "Hiring Manager at Northwind",
            "description": "Reach me at alex.rivera@northwind.test for roles.",
        },
    )
    assert len(drafts) >= 1
    assert drafts[0].email == "alex.rivera@northwind.test"
    assert drafts[0].signals.get("source") == "linkedin_post"
    assert "Alex" in (drafts[0].name or "")


def test_noreply_excluded():
    drafts = extract_from_job(
        title="Role",
        company="Acme",
        location="",
        job_url="https://www.linkedin.com/jobs/view/1",
        list_payload={},
        detail_payload={"description": "noreply@acme.com and real jane@acme.com"},
    )
    assert all(d.email != "noreply@acme.com" for d in drafts)
    assert any(d.email == "jane@acme.com" for d in drafts)


def test_job_text_includes_list_and_detail():
    text = job_text_for_extract(
        {
            "title": "T",
            "company": "C",
            "list_payload": {"snippet": "list-bit"},
            "detail_payload": {"description": "detail-bit"},
        }
    )
    assert "list-bit" in text and "detail-bit" in text


def test_free_mail_email_falls_back_to_job_company():
    drafts = extract_from_job(
        title="Engineer",
        company="Acme Corp",
        location="",
        job_url="https://www.linkedin.com/jobs/view/5",
        list_payload={},
        detail_payload={"description": "Send CV to hiring.team@gmail.com"},
    )
    assert [d.email for d in drafts] == ["hiring.team@gmail.com"]
    assert drafts[0].company == "Acme Corp"
    assert drafts[0].selected is False
    assert "hiring.team@gmail.com" in drafts[0].snippet
    assert drafts[0].signals.get("source") == "linkedin_job_post"


def test_free_mail_fallback_skips_hard_rejected_and_needs_company():
    drafts = extract_from_job(
        title="",
        company="",
        location="",
        job_url="",
        list_payload={},
        detail_payload={"description": "Send CV to a.b@gmail.com or noreply@acme.com"},
    )
    assert drafts == []


def test_snippet_uses_near_email_context_not_job_header():
    drafts = extract_from_job(
        title="Backend Engineer",
        company="Acme Corp",
        location="Remote",
        job_url="https://www.linkedin.com/jobs/view/6",
        list_payload={},
        detail_payload={"description": "Contact recruiter Jane Doe at jane@acme.com for details."},
    )
    assert len(drafts) == 1
    assert "jane@acme.com" in drafts[0].snippet


def test_search_results_url_replaced_with_activity_permalink():
    url = canonicalize_post_url(
        job_url="https://www.linkedin.com/search/results/content/?keywords=email",
        linkedin_job_id="p7123456789012345678",
    )
    assert url == "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/"

    drafts = extract_from_job(
        title="Alex Rivera",
        company="",
        location="",
        job_url="https://www.linkedin.com/search/results/content/?keywords=hiring",
        list_payload={"kind": "post", "author": "Alex Rivera"},
        detail_payload={
            "kind": "post",
            "description": "Email me alex.rivera@northwind.test",
        },
        linkedin_job_id="p7123456789012345678",
    )
    assert drafts[0].email == "alex.rivera@northwind.test"
    assert drafts[0].source_url == (
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/"
    )
