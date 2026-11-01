import io
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


def ocr(image):
    import pytesseract

    return pytesseract.image_to_string(image, timeout=45)


def read_document(path: Path, extension: str):
    check_archive(path)
    if extension == ".pdf":
        import fitz
        from PIL import Image

        with fitz.open(path) as doc:
            if len(doc) > 200:
                raise ValueError("Maximum 200 PDF pages")
            text = []
            for page in doc:
                raw = page.get_text()
                if len(raw.strip()) < 20:
                    pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
                    raw = ocr(Image.open(io.BytesIO(pix.tobytes("png"))))
                text.append(raw)
            return "\n".join(text), []
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
        from PIL import Image

        Image.MAX_IMAGE_PIXELS = 25_000_000
        with Image.open(path) as image:
            return ocr(image), []
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


def extract_recipients(text, rows=None):
    found = {}
    duplicates = 0
    sources = rows or [{"text": line} for line in text.splitlines()]
    for row in sources:
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
                "name": row.get("name", row.get("full name", "")),
                "company": row.get("company", row.get("organization", "")),
                "position": row.get("position", row.get("title", "")),
                "custom_fields": {
                    k: v
                    for k, v in row.items()
                    if k not in ("email", "name", "company", "position", "text")
                },
            }
    return list(found.values()), duplicates
