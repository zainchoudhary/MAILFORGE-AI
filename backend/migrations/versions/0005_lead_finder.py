"""Add lead search runs and candidates."""
from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "lead_search_runs",
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("brief", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("target_count", sa.Integer(), nullable=False),
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
    op.create_index("ix_lead_search_runs_created_by_user_id", "lead_search_runs", ["created_by_user_id"])
    op.create_index("ix_lead_search_runs_status", "lead_search_runs", ["status"])
    op.create_index("ix_lead_search_runs_organization_id", "lead_search_runs", ["organization_id"])
    op.create_index("ix_lead_search_runs_created_at", "lead_search_runs", ["created_at"])
    op.create_table(
        "lead_candidates",
        sa.Column("run_id", sa.String(length=36), nullable=False),
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
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["lead_search_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "email"),
    )
    op.create_index("ix_lead_candidates_run_id", "lead_candidates", ["run_id"])
    op.create_index("ix_lead_candidates_organization_id", "lead_candidates", ["organization_id"])
    op.create_index("ix_lead_candidates_created_at", "lead_candidates", ["created_at"])


def downgrade():
    op.drop_index("ix_lead_candidates_created_at", table_name="lead_candidates")
    op.drop_index("ix_lead_candidates_organization_id", table_name="lead_candidates")
    op.drop_index("ix_lead_candidates_run_id", table_name="lead_candidates")
    op.drop_table("lead_candidates")
    op.drop_index("ix_lead_search_runs_created_at", table_name="lead_search_runs")
    op.drop_index("ix_lead_search_runs_organization_id", table_name="lead_search_runs")
    op.drop_index("ix_lead_search_runs_status", table_name="lead_search_runs")
    op.drop_index("ix_lead_search_runs_created_by_user_id", table_name="lead_search_runs")
    op.drop_table("lead_search_runs")
