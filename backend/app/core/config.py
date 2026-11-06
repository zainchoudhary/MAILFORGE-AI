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
    delay_between_emails: float = 2
    # Temporary SMTP/provider faults are common. Retry enough times to ride
    # out short outages without ever re-sending an uncertain SMTP outcome.
    max_retries: int = 5
    max_attachment_bytes: int = 18000000
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_security: str = "starttls"
    smtp_timeout: int = 30
    # Dedicated Outreach Studio sender for system mail only. Never used for campaigns.
    system_mail_host: str = ""
    system_mail_port: int = 587
    system_mail_security: str = "starttls"
    system_mail_username: str = ""
    system_mail_password: str = ""
    system_mail_from: str = ""
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
    lead_search_provider: str = "serper"  # serper | google_cse
    serper_api_key: str = ""
    google_cse_api_key: str = ""
    google_cse_cx: str = ""
    lead_finder_max_per_run: int = 100
    lead_finder_first_batch: int = 20
    lead_finder_fetch_timeout: int = 15
    lead_finder_max_page_bytes: int = 1500000
    lead_finder_allow_private_fetch: bool = False

    @model_validator(mode="after")
    def secrets(self):
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 characters")
        return self


@lru_cache
def get_settings():
    return Settings()
