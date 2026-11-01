"""One account per data namespace; allow historical messages after contact deletion."""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    shared = op.get_bind().execute(sa.text(
        'SELECT organization_id FROM users GROUP BY organization_id HAVING count(*) > 1 LIMIT 1'
    )).first()
    if shared:
        raise RuntimeError('Shared namespace found. Assign historical ownership explicitly before migration; no data was reassigned.')
    op.create_unique_constraint('uq_users_private_namespace', 'users', ['organization_id'])
    op.alter_column('email_messages', 'recipient_id', existing_type=sa.String(36), nullable=True)


def downgrade():
    if op.get_bind().execute(sa.text('SELECT 1 FROM email_messages WHERE recipient_id IS NULL LIMIT 1')).first():
        raise RuntimeError('Cannot downgrade after a historical recipient was permanently deleted.')
    op.alter_column('email_messages', 'recipient_id', existing_type=sa.String(36), nullable=False)
    op.drop_constraint('uq_users_private_namespace', 'users', type_='unique')
