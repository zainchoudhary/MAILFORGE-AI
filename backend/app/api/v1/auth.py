import hashlib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.database.session import get_db
from app.models.entities import Organization, User, RefreshSession, now
from app.schemas.inputs import Register, Login, Refresh
from app.security.auth import passwords, tokens, current_user
from app.repositories.common import serialize, audit

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", status_code=201)
def register(data: Register, db=Depends(get_db)):
    org = Organization(name=data.organization)
    db.add(org)
    db.flush()
    user = User(
        organization_id=org.id,
        email=str(data.email).lower(),
        name=data.name,
        password_hash=passwords.hash(data.password),
    )
    db.add(user)
    try:
        db.flush()
        audit(db, user, "auth.registered", user.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with that email already exists")
    return tokens(db, user)


@router.post("/login")
def login(data: Login, db=Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(data.email).lower()))
    # Perform a hash verification even for unknown accounts.
    valid = passwords.verify(data.password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid:
        raise HTTPException(401, "Invalid email or password")
    return tokens(db, user)


DUMMY_HASH = passwords.hash("unusable-random-dummy-password")


@router.post("/refresh")
def refresh(data: Refresh, db=Depends(get_db)):
    session = db.scalar(
        select(RefreshSession)
        .where(RefreshSession.token_hash == hashlib.sha256(data.refresh_token.encode()).hexdigest())
        .with_for_update()
    )
    if not session or session.revoked or session.expires_at <= now():
        raise HTTPException(401, "Invalid refresh token")
    session.revoked = True
    return tokens(db, db.get(User, session.user_id))


@router.get("/me")
def me(user=Depends(current_user)):
    return serialize(user, ("password_hash", "token_version"))


@router.post("/logout")
def logout(user=Depends(current_user), db=Depends(get_db)):
    user.token_version += 1
    for session in db.scalars(
        select(RefreshSession).where(
            RefreshSession.user_id == user.id, RefreshSession.revoked.is_(False)
        )
    ):
        session.revoked = True
    db.commit()
    return {"ok": True}
