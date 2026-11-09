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
    assert drafts[0].source_url.rstrip("/").endswith("/123")
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
    assert drafts[0].signals.get("post_url") == drafts[0].source_url


def test_canonicalize_prefers_posts_slug_over_feed_urn():
    url = canonicalize_post_url(
        job_url="https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
        detail_payload={
            "post_url": "https://www.linkedin.com/posts/alex-rivera-activity-7123456789012345678-abc"
        },
    )
    assert url == "https://www.linkedin.com/posts/alex-rivera-activity-7123456789012345678-abc/"


def test_feed_post_header_fills_author_and_posted_when_payload_author_missing():
    body = (
        "Feed post Muhammad Zubair • 2nd Customer Experience & Operations Leader | "
        "Customer Success 2h Follow Hiring — email mz0340091@gmail.com today"
    )
    drafts = extract_from_job(
        title="LinkedIn post",
        company="",
        location="",
        job_url="https://www.linkedin.com/feed/update/urn:li:activity:8111111111111111111/",
        list_payload={"kind": "post", "author": ""},
        detail_payload={"kind": "post", "author": "", "description": body},
        linkedin_job_id="p8111111111111111111",
    )
    d = next(x for x in drafts if x.email == "mz0340091@gmail.com")
    assert d.name == "Muhammad Zubair"
    assert "Customer Experience" in (d.position or "")
    assert d.signals.get("posted_at_text") == "2h"
    body_out = d.signals.get("post_body") or ""
    assert "mz0340091@gmail.com" in body_out
    assert "• 2nd" not in body_out  # actor chrome stripped from View post body


def test_header_without_feed_post_prefix_and_rejects_junk_near_email_name():
    body = (
        "Abbas • 2nd Strategic HR Leader | Driving Workforce Transformation Across "
        "Middle East & US audiences 8h · Visible to anyone on or off LinkedIn "
        "Working Hours: 3:00 PM – 12:00 AM Apply ayeshaasim@businessupscalers.com"
    )
    drafts = extract_from_job(
        title="LinkedIn post",
        company="US",
        location="",
        job_url="https://www.linkedin.com/posts/abbas-activity-8555555555555555555-abc/",
        list_payload={"kind": "post", "author": "", "subtitle": ""},
        detail_payload={"kind": "post", "author": "", "description": body},
        linkedin_job_id="p8555555555555555555",
    )
    d = next(x for x in drafts if x.email == "ayeshaasim@businessupscalers.com")
    assert d.name == "Abbas"
    assert "Strategic HR Leader" in (d.position or "")
    assert d.signals.get("posted_at_text") == "8h"
    assert d.company == ""  # junk "US" must not stick
    assert d.name.lower() != "working hours"


def test_full_name_and_company_from_at_headline():
    body = (
        "Fatima Khan • 2nd Founder & CEO @ Databiqs 2h Follow "
        "Hiring in Lahore — email hr@databiqs.com today"
    )
    drafts = extract_from_job(
        title="Khan",
        company="Founder & CEO @ Databiqs",
        location="",
        job_url="https://www.linkedin.com/posts/fatima-khan-activity-8666666666666666666-abc/",
        list_payload={
            "kind": "post",
            "author": "Khan",
            "subtitle": "Founder & CEO @ Databiqs",
        },
        detail_payload={
            "kind": "post",
            "author": "Khan",
            "subtitle": "Founder & CEO @ Databiqs",
            "description": body,
        },
        linkedin_job_id="p8666666666666666666",
    )
    d = next(x for x in drafts if x.email == "hr@databiqs.com")
    assert d.name == "Fatima Khan"
    assert d.position == "Founder & CEO @ Databiqs"
    assert d.company == "Databiqs"


def test_bizscale_company_not_phrase_and_name_from_posts_url():
    body = (
        "We're looking for a talented SEO CONTENT WRITER to join our growing team at BIZSCALE! "
        "Send CV to ayeshaasim@businessupscalers.com"
    )
    drafts = extract_from_job(
        title="LinkedIn post",
        company="our growing team at BIZSCA",
        location="",
        job_url="https://www.linkedin.com/posts/ayesha-sibtain-abbas-activity-8888888888888888888-AbCd/",
        list_payload={"kind": "post", "author": "", "subtitle": "", "posted_at_text": ""},
        detail_payload={
            "kind": "post",
            "author": "",
            "subtitle": "",
            "description": body,
        },
        linkedin_job_id="p8888888888888888888",
    )
    d = next(x for x in drafts if x.email == "ayeshaasim@businessupscalers.com")
    assert d.name == "Ayesha Sibtain Abbas"
    assert d.company == "BIZSCALE"
    assert "growing team" not in (d.company or "").lower()


def test_strips_header_chrome_and_company_from_hiring_at_body():
    mashed = (
        "Ehsan • 2nd HR Executive & Talent Acquisition Specialist | Full-Cycle IT Recruitment | "
        "LinkedIn Headhunting | HRIS & HR Ops | Open to Remote 7h Connect Hiring at TechPrysm! "
        "Location: DHA Phase 8, Lahore Apply at: careers@techprysm.com … more 56 11 4"
    )
    drafts = extract_from_job(
        title="Ehsan",
        company="",
        location="",
        job_url="https://www.linkedin.com/posts/halima-ehsan-activity-8777777777777777777-AbCd/",
        list_payload={
            "kind": "post",
            "author": "Ehsan",
            "subtitle": (
                "HR Executive & Talent Acquisition Specialist | Full-Cycle IT Recruitment | "
                "LinkedIn Headhunting | HRIS & HR Ops | Open to Remote"
            ),
            "posted_at_text": "7h",
        },
        detail_payload={
            "kind": "post",
            "author": "Halima Ehsan",
            "subtitle": (
                "HR Executive & Talent Acquisition Specialist | Full-Cycle IT Recruitment | "
                "LinkedIn Headhunting | HRIS & HR Ops | Open to Remote"
            ),
            "posted_at_text": "7h",
            "description": mashed,
        },
        linkedin_job_id="p8777777777777777777",
    )
    d = next(x for x in drafts if x.email == "careers@techprysm.com")
    assert d.name == "Halima Ehsan"
    assert d.company == "TechPrysm"
    assert "HR Executive" in (d.position or "")
    body = d.signals.get("post_body") or ""
    assert body.startswith("Hiring at TechPrysm!")
    assert "• 2nd" not in body
    assert "7h Connect" not in body
    assert "56 11 4" not in body


def test_post_maps_designation_date_and_full_body_into_candidate():
    body = (
        "Hiring backend. Email alex.rivera@northwind.test\n"
        "Full JD: Python, FastAPI, Postgres. Apply this week."
    )
    drafts = extract_from_job(
        title="Alex Rivera",
        company="Hiring Manager at Northwind",
        location="",
        job_url="https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
        list_payload={
            "kind": "post",
            "author": "Alex Rivera",
            "subtitle": "Hiring Manager at Northwind",
            "posted_at": "2026-11-08T14:30:00.000Z",
            "posted_at_text": "1d",
        },
        detail_payload={
            "kind": "post",
            "author": "Alex Rivera",
            "subtitle": "Hiring Manager at Northwind",
            "posted_at": "2026-11-08T14:30:00.000Z",
            "posted_at_text": "1d",
            "description": body,
        },
        linkedin_job_id="p7123456789012345678",
    )
    assert len(drafts) >= 1
    d = next(x for x in drafts if x.email == "alex.rivera@northwind.test")
    assert d.name == "Alex Rivera"
    assert d.position == "Hiring Manager at Northwind"
    assert d.signals.get("posted_at") == "2026-11-08T14:30:00.000Z"
    assert d.signals.get("posted_at_text") == "1d"
    assert "Full JD: Python" in (d.signals.get("post_body") or "")
