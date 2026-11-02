"""Prevent duplicate group names within a private account namespace."""
from alembic import op


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_recipient_groups_organization_name", "recipient_groups", ["organization_id", "name"]
    )


def downgrade():
    op.drop_constraint("uq_recipient_groups_organization_name", "recipient_groups", type_="unique")
