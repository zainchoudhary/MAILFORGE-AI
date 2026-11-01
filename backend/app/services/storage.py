import hashlib
import socket
import uuid
from pathlib import Path
import subprocess
import tempfile

try:
    import magic
except ImportError:
    magic = None
from fastapi import HTTPException
from app.core.config import get_settings
from app.document_processing.parser import ALLOWED, check_archive
from app.models.entities import Document

MIMES = {
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".doc": {"application/msword", "application/x-ole-storage", "application/CDFV2"},
    ".xls": {"application/vnd.ms-excel", "application/x-ole-storage", "application/CDFV2"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
    },
    ".xlsx": {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/zip",
    },
    ".txt": {"text/plain"},
    ".csv": {"text/plain", "text/csv", "application/csv"},
    ".json": {"application/json", "text/plain"},
    ".xml": {"text/xml", "application/xml", "text/plain"},
}


def scan(data):
    s = get_settings()
    if not s.clamav_host:
        if s.require_malware_scan:
            raise HTTPException(503, "Malware scanner is required but unavailable")
        return "not_configured"
    try:
        with socket.create_connection((s.clamav_host, 3310), timeout=30) as conn:
            conn.sendall(b"zINSTREAM\0")
            for i in range(0, len(data), 65536):
                chunk = data[i : i + 65536]
                conn.sendall(len(chunk).to_bytes(4, "big") + chunk)
            conn.sendall(b"\0\0\0\0")
            response = conn.recv(4096)
        if b"OK" not in response:
            raise HTTPException(422, "File rejected by malware scanner")
        return "clean"
    except OSError:
        raise HTTPException(503, "Malware scanner unavailable")


async def upload(db, user, file):
    s = get_settings()
    filename = Path(file.filename or "file").name[:255]
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(415, "Unsupported file extension")
    data = await file.read(s.max_attachment_bytes + 1)
    if not data or len(data) > s.max_attachment_bytes:
        raise HTTPException(413, "File is empty or exceeds upload limit")
    if magic is not None:
        mime = magic.from_buffer(data, mime=True)
    else:
        # macOS development fallback uses the system libmagic-backed file utility.
        with tempfile.NamedTemporaryFile() as probe:
            probe.write(data)
            probe.flush()
            mime = subprocess.run(
                ["file", "--mime-type", "-b", probe.name],
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            ).stdout.strip()
    if mime not in MIMES[ext]:
        raise HTTPException(415, "File content does not match extension")
    scan_status = scan(data)
    root = Path(s.storage_path)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = f"{uuid.uuid4()}{ext}"
    path = root / key
    path.write_bytes(data)
    path.chmod(0o600)
    try:
        check_archive(path)
        record = Document(
            organization_id=user.organization_id,
            filename=filename,
            storage_key=key,
            mime_type=mime,
            size=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
            scan_status=scan_status,
        )
        db.add(record)
        db.flush()
        return record
    except Exception:
        path.unlink(missing_ok=True)
        raise
