from app.lead_finder.extract import extract_candidates_from_text, is_hard_rejected_email, normalize_email


def test_normalize_and_hard_reject():
    assert normalize_email(" Alex@Acme.COM ") == "alex@acme.com"
    assert is_hard_rejected_email("noreply@acme.com")
    assert is_hard_rejected_email("no-reply@acme.com")
    assert not is_hard_rejected_email("jane.doe@acme.com")


def test_extract_requires_email_and_name_or_company():
    text = "Jane Doe is a Technical Recruiter at Acme. Contact jane.doe@acme.com for roles."
    drafts = extract_candidates_from_text(text, source_url="https://acme.com/team")
    assert len(drafts) == 1
    assert drafts[0].email == "jane.doe@acme.com"
    assert "Jane" in drafts[0].name or drafts[0].company
    assert drafts[0].selected is True  # recruiter title heuristic


def test_info_at_without_person_name_is_deselected():
    text = "Careers: info@startup.io hiring recruiters"
    drafts = extract_candidates_from_text(text, source_url="https://startup.io/jobs")
    assert drafts
    assert all(d.selected is False for d in drafts if d.email.startswith("info@"))


def test_noreply_never_returned():
    text = "Send bounce to noreply@acme.com — Jane Recruiter jane@acme.com"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert all(d.email != "noreply@acme.com" for d in drafts)
    assert any(d.email == "jane@acme.com" for d in drafts)


def test_asset_filenames_are_not_emails():
    text = "<img src=logo@2x.png> Visit Acme recruiter page"
    assert extract_candidates_from_text(text, source_url="https://acme.com") == []
    blocked = " ".join(
        f"file@cdn.{tld}"
        for tld in ("png", "jpg", "jpeg", "gif", "svg", "webp", "css", "js", "ico", "map")
    )
    text = f"Jane Doe Recruiter jane.doe@acme.com {blocked}"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert [draft.email for draft in drafts] == ["jane.doe@acme.com"]


def test_strips_leading_punctuation_from_local_part():
    text = "Jane Doe Recruiter .jane.doe@acme.com"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert [draft.email for draft in drafts] == ["jane.doe@acme.com"]


def test_noreply_style_locals_never_returned():
    assert is_hard_rejected_email("no_reply@acme.com")
    assert is_hard_rejected_email("no.reply@acme.com")
    assert is_hard_rejected_email("noreply+abc@acme.com")
    assert is_hard_rejected_email("postmaster@acme.com")
    assert is_hard_rejected_email("do-not-reply@acme.com")
    assert is_hard_rejected_email("mailer_daemon@acme.com")
    assert is_hard_rejected_email("bounce@acme.com")
    assert is_hard_rejected_email("bounces@acme.com")
    text = (
        "no_reply@acme.com noreply+abc@acme.com postmaster@acme.com "
        "Jane Doe Recruiter jane.doe@acme.com"
    )
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    emails = {draft.email for draft in drafts}
    assert "no_reply@acme.com" not in emails
    assert "noreply+abc@acme.com" not in emails
    assert "postmaster@acme.com" not in emails
    assert emails == {"jane.doe@acme.com"}


def test_titles_and_names_do_not_leak_across_neighbouring_emails():
    text = (
        "Jane Doe, Recruiter jane.doe@acme.com. "
        "John Smith, Engineer john.smith@acme.com. "
        "Mary Lee, Designer mary.lee@acme.com."
    )
    drafts = extract_candidates_from_text(text, source_url="https://acme.com/team")
    by_email = {draft.email: draft for draft in drafts}
    jane = by_email["jane.doe@acme.com"]
    john = by_email["john.smith@acme.com"]
    mary = by_email["mary.lee@acme.com"]
    assert jane.name == "Jane Doe"
    assert jane.selected is True
    assert jane.score > 0
    assert john.name == "John Smith"
    assert john.selected is False
    assert "title" not in john.signals
    assert mary.name == "Mary Lee"
    assert mary.selected is False
    assert "title" not in mary.signals


def test_title_after_a_single_email_still_selects():
    text = "Contact jane.doe@acme.com — Jane Doe is a Recruiter at Acme."
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert len(drafts) == 1
    assert drafts[0].name == "Jane Doe"
    assert drafts[0].selected is True
    assert drafts[0].score > 0


def test_contact_us_does_not_select_generic_inbox():
    text = "Contact Us info@acme.com for questions about Talent Acquisition"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert len(drafts) == 1
    assert drafts[0].email == "info@acme.com"
    assert drafts[0].selected is False
    assert "Contact" not in drafts[0].name.split()


def test_name_strips_leading_labels_and_trailing_roles():
    for prefix in ("Email", "Contact", "Reach", "Visit", "Meet"):
        text = f"{prefix} Jane Doe Recruiter jane.doe@acme.com"
        drafts = extract_candidates_from_text(text, source_url="https://acme.com/team")
        assert len(drafts) == 1, prefix
        assert drafts[0].name == "Jane Doe", prefix
        assert drafts[0].selected is True, prefix
        assert drafts[0].score > 0, prefix


def test_chrome_phrases_are_not_person_names():
    text = "Talent Acquisition Team info@acme.com"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert len(drafts) == 1
    assert drafts[0].email == "info@acme.com"
    assert drafts[0].name == ""
    assert drafts[0].selected is False

    freemail = extract_candidates_from_text(
        "Our Team Page jane@gmail.com",
        source_url="https://acme.com/team",
    )
    assert freemail == []

    for phrase in ("Get Started", "Contact Us", "Our Team Page"):
        drafts = extract_candidates_from_text(
            f"{phrase} info@acme.com",
            source_url="https://acme.com",
        )
        assert len(drafts) == 1, phrase
        assert drafts[0].email == "info@acme.com", phrase
        assert drafts[0].name == "", phrase
        assert drafts[0].selected is False, phrase


def test_leading_role_words_stripped_from_person_name():
    text = "jane.doe@acme.com Talent Acquisition Jane Doe"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert len(drafts) == 1
    assert drafts[0].name == "Jane Doe"
    assert drafts[0].selected is True


def test_font_image_and_media_filenames_are_not_emails():
    for token in ("sprite@2x.woff2", "font@2x.woff", "icon@2x.avif"):
        drafts = extract_candidates_from_text(
            f"Visit Acme recruiter page {token}",
            source_url="https://acme.com",
        )
        assert drafts == [], token
    blocked = " ".join(
        f"file@cdn.{tld}"
        for tld in (
            "woff",
            "woff2",
            "ttf",
            "eot",
            "otf",
            "avif",
            "bmp",
            "tiff",
            "tif",
            "mp4",
            "webm",
            "pdf",
            "mp3",
            "mov",
        )
    )
    text = f"Jane Doe Recruiter jane.doe@acme.com {blocked}"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert [draft.email for draft in drafts] == ["jane.doe@acme.com"]


def test_retina_domain_label_is_not_a_company():
    text = "Jane Doe Recruiter jane.doe@2x.com"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert len(drafts) == 1
    assert drafts[0].company == ""
    assert drafts[0].name == "Jane Doe"


def test_rejected_matches_do_not_cut_neighbour_names():
    text = "Jane Doe Recruiter logo@2x.png jane.doe@acme.com"
    drafts = extract_candidates_from_text(text, source_url="https://acme.com")
    assert len(drafts) == 1
    assert drafts[0].email == "jane.doe@acme.com"
    assert drafts[0].name == "Jane Doe"
    assert drafts[0].selected is True
