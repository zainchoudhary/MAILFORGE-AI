import json
import re
import subprocess
import zipfile
from pathlib import Path
from email_validator import validate_email, EmailNotValidError
from defusedxml import ElementTree

EMAIL_PATTERN = re.compile(
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}"
)
HEADER_PATTERN = re.compile(r"[^a-z0-9]+")
RECIPIENT_FIELD_ALIASES = {
    "email": {"email", "emailaddress", "emailid", "emailaddress", "workemail", "businessemail", "e-mail"},
    "name": {"name", "fullname", "contactname", "recipientname"},
    "company": {"company", "companyname", "organization", "organisation", "employer", "business"},
    "position": {"position", "jobtitle", "title", "role", "designation", "jobrole"},
}
ALLOWED = {
    ".pdf",
    ".docx",
    ".doc",
    ".xlsx",
    ".xls",
    ".csv",
    ".xml",
    ".txt",
    ".json",
    ".png",
    ".jpg",
    ".jpeg",
}


def check_archive(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            if (
                sum(f.file_size for f in archive.infolist()) > 100_000_000
                or len(archive.infolist()) > 10000
            ):
                raise ValueError("Archive exceeds safe decompression limits")


def read_document(path: Path, extension: str):
    check_archive(path)
    if extension == ".pdf":
        import fitz

        with fitz.open(path) as doc:
            if len(doc) > 200:
                raise ValueError("Maximum 200 PDF pages")
            return "\n".join(page.get_text() for page in doc), []
    if extension == ".docx":
        from docx import Document

        doc = Document(path)
        lines = [p.text for p in doc.paragraphs]
        lines += [
            " | ".join(c.text for c in row.cells) for table in doc.tables for row in table.rows
        ]
        return "\n".join(lines), []
    if extension == ".doc":
        result = subprocess.run(
            ["antiword", str(path)], capture_output=True, timeout=30, check=True
        )
        return result.stdout.decode("utf-8", errors="replace"), []
    if extension in (".xlsx", ".xls", ".csv"):
        import pandas as pd

        if extension == ".csv":
            frames = [pd.read_csv(path, dtype=str, keep_default_na=False, nrows=50001)]
        else:
            frames = list(
                pd.read_excel(path, sheet_name=None, dtype=str, keep_default_na=False).values()
            )
        if sum(len(f) for f in frames) > 50000:
            raise ValueError("Maximum 50,000 spreadsheet rows")
        records = [
            {str(k).strip().lower(): str(v) for k, v in row.items()}
            for frame in frames
            for row in frame.to_dict("records")
        ]
        return "\n".join(" | ".join(r.values()) for r in records), records
    if extension in (".png", ".jpg", ".jpeg"):
        # Images are stored as private attachments; they are not contact-import
        # sources and are intentionally never sent through OCR.
        return "", []
    raw = path.read_text(encoding="utf-8-sig")
    if extension == ".xml":
        root = ElementTree.fromstring(raw)
        return " ".join(root.itertext()), []
    if extension == ".json":
        parsed = json.loads(raw)
        rows = parsed if isinstance(parsed, list) else [parsed]
        records = [
            {str(k).lower(): str(v) for k, v in r.items()} for r in rows if isinstance(r, dict)
        ]
        return raw, records
    return raw, []


def _header_key(value):
    return HEADER_PATTERN.sub("", str(value).strip().lower())


def _value_for_alias(row, aliases):
    for key, value in row.items():
        if _header_key(key) in aliases and str(value).strip():
            return str(value).strip()
    return ""


def _recipient_fields(row):
    normalized = {_header_key(key): key for key in row}
    name = _value_for_alias(row, RECIPIENT_FIELD_ALIASES["name"])
    if not name:
        first_name = _value_for_alias(row, {"firstname", "givenname"})
        last_name = _value_for_alias(row, {"lastname", "surname", "familyname"})
        name = " ".join(part for part in (first_name, last_name) if part)
    used = {
        original_key
        for normalized_key, original_key in normalized.items()
        if any(normalized_key in aliases for aliases in RECIPIENT_FIELD_ALIASES.values())
        or normalized_key in {"firstname", "givenname", "lastname", "surname", "familyname"}
    }
    return {
        "email": _value_for_alias(row, RECIPIENT_FIELD_ALIASES["email"]),
        "name": name,
        "company": _value_for_alias(row, RECIPIENT_FIELD_ALIASES["company"]),
        "position": _value_for_alias(row, RECIPIENT_FIELD_ALIASES["position"]),
        "custom_fields": {key: value for key, value in row.items() if key not in used and key != "text"},
    }


def extract_recipients(text, rows=None):
    found = {}
    duplicates = 0
    sources = rows or [{"text": line} for line in text.splitlines()]
    for row in sources:
        fields = _recipient_fields(row)
        for candidate in EMAIL_PATTERN.findall(" ".join(str(v) for v in row.values())):
            try:
                email = validate_email(candidate, check_deliverability=False).normalized.lower()
            except EmailNotValidError:
                continue
            if email in found:
                duplicates += 1
                continue
            found[email] = {
                "email": email,
                "name": fields["name"],
                "company": fields["company"],
                "position": fields["position"],
                "custom_fields": fields["custom_fields"],
            }
    return list(found.values()), duplicates
