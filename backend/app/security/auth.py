import hashlib
import secrets
from datetime import timedelta
import jwt
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pwdlib import PasswordHash
from app.core.config import get_settings
from app.database.session import get_db
from app.models.entities import User, RefreshSession, now

passwords = PasswordHash.recommended()
bearer = HTTPBearer()


def encrypt(value):
    return Fernet(get_settings().encryption_key.encode()).encrypt(value.encode()).decode()


def decrypt(value):
    return Fernet(get_settings().encryption_key.encode()).decrypt(value.encode()).decode()


def tokens(db, user, refresh_token: str | None = None):
    settings = get_settings()
    access = jwt.encode(
        {
            "sub": user.id,
            "ver": user.token_version,
            "type": "access",
            "exp": now() + timedelta(minutes=settings.jwt_access_minutes),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    refresh = refresh_token or secrets.token_urlsafe(48)
    # Keep a valid refresh session stable across page reloads. Rotating it on every
    # refresh creates a race: a browser reload can cancel the response after the
    # server revokes the old token, leaving the client with an unusable session.
    if refresh_token is None:
        db.add(
            RefreshSession(
                organization_id=user.organization_id,
                user_id=user.id,
                token_hash=hashlib.sha256(refresh.encode()).hexdigest(),
                expires_at=now() + timedelta(days=7),
            )
        )
        db.commit()
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer), db=Depends(get_db)):
    try:
        payload = jwt.decode(
            credentials.credentials, get_settings().jwt_secret, algorithms=["HS256"]
        )
        user = db.get(User, payload["sub"])
        if not user or payload.get("type") != "access" or payload.get("ver") != user.token_version:
            raise ValueError()
        return user
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(401, "Invalid or expired access token")


def editor(user=Depends(current_user)):
    if user.role not in ("admin", "editor"):
        raise HTTPException(403, "Editor role required")
    return user


def admin(user=Depends(current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Administrator role required")
    return user
