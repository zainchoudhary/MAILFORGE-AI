"""Optional development workspace. No artificial campaign metrics or sent messages."""

import os
from sqlalchemy import select
from app.database.session import SessionLocal
from app.models.entities import Organization, User, Template
from app.security.auth import passwords


def main():
    email = os.environ.get("SEED_EMAIL")
    password = os.environ.get("SEED_PASSWORD")
    if not email or not password or len(password) < 12:
        raise SystemExit("Set SEED_EMAIL and SEED_PASSWORD (12+ characters).")
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.email == email.lower())):
            print("Seed user already exists. No changes.")
            return
        org = Organization(name="Development workspace")
        db.add(org)
        db.flush()
        db.add(
            User(
                organization_id=org.id,
                name="Workspace admin",
                email=email.lower(),
                password_hash=passwords.hash(password),
            )
        )
        db.add(
            Template(
                organization_id=org.id,
                name="Partnership introduction",
                subject="A conversation with {{company}}",
                body="<p>Hello {{name}},</p><p>I would like to explore a potential partnership with {{company}}. Would you be available for a brief conversation?</p><p>Best regards</p>",
            )
        )
        db.commit()
        print(
            "Development workspace and starter template created. No recipients or sending history were fabricated."
        )


if __name__ == "__main__":
    main()
