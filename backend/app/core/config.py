from functools import lru_cache
from pathlib import Path
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Keep the single real secret file with the backend service.
        env_file=Path(__file__).resolve().parents[2] / ".env",
        extra="ignore",
    )
    database_url: str
    # Redis is only needed for background workers. The API remains usable without it.
    redis_url: str = ""
    jwt_secret: str
    encryption_key: str
    jwt_access_minutes: int = 30
    cors_origins: str = "http://localhost:5173,http://localhost:8080"
    storage_path: str = ".local/uploads"
    dry_run: bool = True
    max_emails_per_run: int = 20
    delay_between_emails: float = 2
    max_retries: int = 2
    max_attachment_bytes: int = 18000000
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_security: str = "starttls"
    smtp_timeout: int = 30
    ai_provider: str = "groq"
    groq_api_key: str = ""
    # Kept configurable: model access differs by Groq account and changes over time.
    groq_model: str = "openai/gpt-oss-20b"
    google_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    public_url: str = "http://localhost:8080"
    clamav_host: str = ""
    require_malware_scan: bool = False
    allow_private_smtp: bool = False
    provider_webhook_secret: str = ""

    @model_validator(mode="after")
    def secrets(self):
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 characters")
        return self


@lru_cache
def get_settings():
    return Settings()
