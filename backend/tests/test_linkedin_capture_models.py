from sqlalchemy import UniqueConstraint

from app.core.config import Settings
from app.models.entities import LinkedInCaptureRun, LinkedInJobRaw, LinkedInLeadCandidate


def _settings(**overrides):
    values = {
        "database_url": "postgresql+psycopg://x@localhost/x",
        "jwt_secret": "x" * 32,
        "encryption_key": "x",
    }
    values.update(overrides)
    return Settings(**values)


def test_linkedin_capture_settings_defaults():
    settings = _settings()
    assert settings.linkedin_capture_max_jobs_per_run == 300
    assert settings.linkedin_capture_hard_ceiling == 500


def test_linkedin_capture_run_columns():
    assert LinkedInCaptureRun.__tablename__ == "linkedin_capture_runs"
    columns = set(LinkedInCaptureRun.__table__.c.keys())
    assert {
        "id",
        "organization_id",
        "created_at",
        "created_by_user_id",
        "search_url",
        "search_query_snapshot",
        "status",
        "progress",
        "error",
        "updated_at",
    } <= columns


def test_linkedin_job_raw_unique_per_run():
    assert LinkedInJobRaw.__tablename__ == "linkedin_job_raw"
    constraints = [c for c in LinkedInJobRaw.__table__.constraints if isinstance(c, UniqueConstraint)]
    assert any(tuple(c.columns.keys()) == ("run_id", "linkedin_job_id") for c in constraints)


def test_linkedin_lead_candidate_matches_lead_candidate_shape():
    assert LinkedInLeadCandidate.__tablename__ == "linkedin_lead_candidates"
    columns = set(LinkedInLeadCandidate.__table__.c.keys())
    assert {
        "run_id",
        "job_raw_id",
        "email",
        "name",
        "company",
        "position",
        "source_url",
        "source_title",
        "snippet",
        "score",
        "signals",
        "selected",
        "existing_recipient_id",
    } <= columns
    constraints = [
        c for c in LinkedInLeadCandidate.__table__.constraints if isinstance(c, UniqueConstraint)
    ]
    assert any(tuple(c.columns.keys()) == ("run_id", "email") for c in constraints)
