import os
import getpass
from pathlib import Path
import pytest

os.environ.setdefault("JWT_SECRET", "integration-test-secret-at-least-32-characters")
os.environ.setdefault("ENCRYPTION_KEY", "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=")
os.environ.setdefault(
    "DATABASE_URL", f"postgresql+psycopg://{getpass.getuser()}@127.0.0.1:55432/mailforge_test"
)
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:56379/15")
os.environ.setdefault("STORAGE_PATH", "/tmp/mailforge-test-uploads")
os.environ["DRY_RUN"] = "true"
from fastapi.testclient import TestClient
from app.database.session import Base, engine, SessionLocal
from app.models import entities
from app.main import app
from app.core.config import get_settings


@pytest.fixture(autouse=True)
def clean_database():
    if not engine.url.database.endswith("_test"):
        raise RuntimeError("Tests require a database whose name ends with _test")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from redis import Redis

    Redis.from_url(os.environ["REDIS_URL"]).flushdb()
    get_settings().dry_run = True
    yield
    get_settings().dry_run = True


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def account(client):
    result = client.post(
        "/api/v1/auth/register",
        json={
            "email": "owner@example.com",
            "password": "strong-test-password",
            "name": "Owner",
            "organization": "Acme",
        },
    )
    assert result.status_code == 201, result.text
    data = result.json()
    headers = {"Authorization": "Bearer " + data["access_token"]}
    return headers


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session
