"""Generate a private local-development env using already generated root secrets."""

import getpass
from pathlib import Path

root = Path(__file__).resolve().parents[1]
values = {}
for line in (root / ".env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        values[key] = value
values.update(
    DATABASE_URL=f"postgresql+psycopg://{getpass.getuser()}@127.0.0.1:55432/mailforge_dev",
    REDIS_URL="redis://127.0.0.1:56379/0",
    STORAGE_PATH=str(root / ".local/uploads"),
    PUBLIC_URL="http://localhost:5173",
    CORS_ORIGINS="http://localhost:5173",
    DRY_RUN="true",
)
path = root / "backend/.env"
if path.exists():
    raise SystemExit("backend/.env exists; left unchanged")
path.write_text("\n".join(f"{k}={v}" for k, v in values.items()) + "\n")
path.chmod(0o600)
print("Created private backend/.env for isolated local services.")
