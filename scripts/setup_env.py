"""Create deployment secrets without printing them. Never overwrites an existing env."""

import base64
import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / ".env"
if path.exists():
    raise SystemExit(".env already exists; left unchanged.")
text = (
    (root / ".env.example")
    .read_text()
    .replace("REPLACE_WITH_RANDOM_PASSWORD", secrets.token_hex(24))
    .replace(
        "REPLACE_WITH_RANDOM_SECRET_AT_LEAST_32_CHARACTERS", secrets.token_urlsafe(48)
    )
    .replace(
        "REPLACE_WITH_FERNET_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode()
    )
)
with path.open("x") as file:
    file.write(text)
path.chmod(0o600)
print("Created private .env with generated secrets. DRY_RUN remains enabled.")
