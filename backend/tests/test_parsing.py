from pathlib import Path
import shutil
import pytest
from app.document_processing.parser import extract_recipients, read_document
from app.schemas.inputs import TemplateInput


def test_email_validation_and_deduplication():
    records, duplicates = extract_recipients(
        "Alex@example.com alex@example.com invalid@ bad@-example.com valid+tag@company.org"
    )
    assert [r["email"] for r in records] == ["alex@example.com", "valid+tag@company.org"]
    assert duplicates == 1


def test_html_sanitization_and_header_injection():
    from pydantic import ValidationError

    item = TemplateInput(
        name="Safe",
        subject="Hi",
        body='<script>alert(1)</script><a href="javascript:alert(1)">link</a><p onclick="alert(1)">hello</p>',
    )
    assert (
        "<script>" not in item.body
        and "javascript:" not in item.body
        and "onclick" not in item.body
    )
    with pytest.raises(ValidationError):
        TemplateInput(name="Bad", subject="Hi\r\nBcc: leak@example.com", body="hello")


@pytest.mark.parametrize("extension", [".txt", ".json", ".xml", ".csv", ".docx", ".xlsx", ".pdf"])
def test_supported_parsers(tmp_path, extension):
    path = tmp_path / ("contacts" + extension)
    if extension == ".docx":
        from docx import Document

        doc = Document()
        doc.add_paragraph("Alex alex@example.com")
        doc.save(path)
    elif extension == ".xlsx":
        from openpyxl import Workbook

        book = Workbook()
        book.active.append(["email", "name"])
        book.active.append(["alex@example.com", "Alex"])
        book.save(path)
    elif extension == ".pdf":
        import fitz

        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 50), "Please contact Alex at alex@example.com for details.")
        doc.save(path)
        doc.close()
    else:
        path.write_text(
            {
                ".txt": "alex@example.com",
                ".json": '[{"email":"alex@example.com","name":"Alex"}]',
                ".xml": "<contacts><email>alex@example.com</email></contacts>",
                ".csv": "email,name\nalex@example.com,Alex\n",
            }[extension]
        )
    text, rows = read_document(path, extension)
    records, _ = extract_recipients(text, rows)
    assert records[0]["email"] == "alex@example.com"


def test_xml_external_entities_rejected(tmp_path):
    path = tmp_path / "evil.xml"
    path.write_text('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>')
    with pytest.raises(Exception):
        read_document(path, ".xml")


@pytest.mark.skipif(not shutil.which("tesseract"), reason="Tesseract native binary is required")
def test_real_ocr(tmp_path):
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1000, 150), "white")
    font = (
        ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 40)
        if Path("/System/Library/Fonts/Supplemental/Arial.ttf").exists()
        else ImageFont.truetype("DejaVuSans.ttf", 40)
    )
    ImageDraw.Draw(image).text((30, 40), "alex@example.com", font=font, fill="black")
    path = tmp_path / "contacts.png"
    image.save(path)
    text, rows = read_document(path, ".png")
    assert extract_recipients(text, rows)[0][0]["email"] == "alex@example.com"
