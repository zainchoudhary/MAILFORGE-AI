from app.linkedin_capture.extract import extract_from_job, job_text_for_extract


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
