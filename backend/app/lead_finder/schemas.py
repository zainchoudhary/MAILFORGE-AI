from pydantic import BaseModel, Field, field_validator


class LeadBrief(BaseModel):
    roles: list[str] = Field(default_factory=lambda: ["recruiter", "talent acquisition"])
    location: str = ""
    keywords: list[str] = Field(default_factory=list)
    industry: str = ""
    target_count: int = Field(default=20, ge=1, le=100)
    exclusions: list[str] = Field(default_factory=list)


class CandidateDraft(BaseModel):
    email: str
    name: str = ""
    company: str = ""
    position: str = ""
    source_url: str
    source_title: str = ""
    snippet: str = ""
    score: float = 0
    signals: dict = Field(default_factory=dict)
    selected: bool = False

    @field_validator("email")
    @classmethod
    def lower(cls, value: str) -> str:
        return value.strip().lower()
