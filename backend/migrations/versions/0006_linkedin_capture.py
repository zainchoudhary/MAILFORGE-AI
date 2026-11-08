"""Add LinkedIn capture runs, raw jobs, and lead candidates."""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "linkedin_capture_runs",
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("search_url", sa.Text(), nullable=False),
        sa.Column("search_query_snapshot", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_linkedin_capture_runs_created_by_user_id", "linkedin_capture_runs", ["created_by_user_id"])
    op.create_index("ix_linkedin_capture_runs_status", "linkedin_capture_runs", ["status"])
    op.create_index("ix_linkedin_capture_runs_organization_id", "linkedin_capture_runs", ["organization_id"])
    op.create_index("ix_linkedin_capture_runs_created_at", "linkedin_capture_runs", ["created_at"])

    op.create_table(
        "linkedin_job_raw",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("linkedin_job_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("company", sa.String(length=300), nullable=False),
        sa.Column("location", sa.String(length=300), nullable=False),
        sa.Column("job_url", sa.Text(), nullable=False),
        sa.Column("list_payload", sa.JSON(), nullable=False),
        sa.Column("detail_payload", sa.JSON(), nullable=True),
        sa.Column("detail_status", sa.String(length=30), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["linkedin_capture_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "linkedin_job_id"),
    )
    op.create_index("ix_linkedin_job_raw_run_id", "linkedin_job_raw", ["run_id"])
    op.create_index("ix_linkedin_job_raw_organization_id", "linkedin_job_raw", ["organization_id"])
    op.create_index("ix_linkedin_job_raw_created_at", "linkedin_job_raw", ["created_at"])

    op.create_table(
        "linkedin_lead_candidates",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("job_raw_id", sa.String(length=36), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("company", sa.String(length=200), nullable=False),
        sa.Column("position", sa.String(length=200), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_title", sa.String(length=500), nullable=False),
        sa.Column("snippet", sa.Text(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("signals", sa.JSON(), nullable=False),
        sa.Column("selected", sa.Boolean(), nullable=False),
        sa.Column("existing_recipient_id", sa.String(length=36), nullable=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["existing_recipient_id"], ["recipients.id"]),
        sa.ForeignKeyConstraint(["job_raw_id"], ["linkedin_job_raw.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["linkedin_capture_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "email"),
    )
    op.create_index("ix_linkedin_lead_candidates_run_id", "linkedin_lead_candidates", ["run_id"])
    op.create_index("ix_linkedin_lead_candidates_organization_id", "linkedin_lead_candidates", ["organization_id"])
    op.create_index("ix_linkedin_lead_candidates_created_at", "linkedin_lead_candidates", ["created_at"])


def downgrade():
    op.drop_index("ix_linkedin_lead_candidates_created_at", table_name="linkedin_lead_candidates")
    op.drop_index("ix_linkedin_lead_candidates_organization_id", table_name="linkedin_lead_candidates")
    op.drop_index("ix_linkedin_lead_candidates_run_id", table_name="linkedin_lead_candidates")
    op.drop_table("linkedin_lead_candidates")
    op.drop_index("ix_linkedin_job_raw_created_at", table_name="linkedin_job_raw")
    op.drop_index("ix_linkedin_job_raw_organization_id", table_name="linkedin_job_raw")
    op.drop_index("ix_linkedin_job_raw_run_id", table_name="linkedin_job_raw")
    op.drop_table("linkedin_job_raw")
    op.drop_index("ix_linkedin_capture_runs_created_at", table_name="linkedin_capture_runs")
    op.drop_index("ix_linkedin_capture_runs_organization_id", table_name="linkedin_capture_runs")
    op.drop_index("ix_linkedin_capture_runs_status", table_name="linkedin_capture_runs")
    op.drop_index("ix_linkedin_capture_runs_created_by_user_id", table_name="linkedin_capture_runs")
    op.drop_table("linkedin_capture_runs")
