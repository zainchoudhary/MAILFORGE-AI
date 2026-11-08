"""Pydantic request bodies for LinkedIn capture (service accepts plain dicts; routers validate with these)."""

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

DETAIL_STATUSES = ("pending", "fetched", "failed", "skipped")


class _Input(BaseModel):
    model_config = ConfigDict(extra="ignore")


class CaptureRunInput(_Input):
    search_url: str = Field(default="", max_length=4000)
    search_query_snapshot: str = Field(default="", max_length=4000)


class CaptureJobInput(_Input):
    linkedin_job_id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=500)
    company: str = Field(default="", max_length=300)
    location: str = Field(default="", max_length=300)
    job_url: str = Field(default="", max_length=4000)
    list_payload: dict = Field(default_factory=dict)
    detail_payload: dict | None = None
    detail_status: str | None = None

    @field_validator("detail_status")
    @classmethod
    def _status(cls, value: str | None) -> str | None:
        if value is not None and value not in DETAIL_STATUSES:
            raise ValueError(f"detail_status must be one of {', '.join(DETAIL_STATUSES)}")
        return value


class CaptureJobsBatchInput(_Input):
    jobs: list[CaptureJobInput] = Field(max_length=500)
    extract: bool = True


class FetchDetailsInput(_Input):
    job_ids: list[str] | None = None


class ExtractInput(_Input):
    job_raw_ids: list[str] | None = None


class CaptureCandidatePatch(_Input):
    email: str | None = Field(default=None, max_length=320)
    name: str | None = Field(default=None, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    position: str | None = Field(default=None, max_length=200)
    selected: bool | None = None

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        if value is None:
            return value
        # Syntax-only check: extracted leads may use reserved/special-use domains (e.g. .test).
        value = value.strip().lower()
        if not re.fullmatch(r"[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;.]{2,}", value):
            raise ValueError("Enter a valid email address")
        return value


class CaptureSaveGroupInput(_Input):
    group_name: str = Field(min_length=1, max_length=200)
    candidate_ids: list[str] | None = None
