import hashlib
import html
import logging
import secrets
from datetime import timedelta
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.database.session import get_db
from app.models.entities import Organization, User, RefreshSession, PasswordResetToken, now
from app.schemas.inputs import Register, Login, Refresh, ForgotPassword, ResetPassword
from app.security.auth import passwords, tokens, current_user
from app.repositories.common import serialize, audit
from app.core.config import get_settings
from app.integrations.system_mail import send_system_mail

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)


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


def send_reset_email(user, token):
    settings = get_settings()
    reset_url = f"{settings.public_url.rstrip('/')}/reset-password?token={quote(token, safe='')}"
    safe_url = html.escape(reset_url, quote=True)
    safe_name = html.escape(user.name or "there")
    send_system_mail(
        user.email,
        "Your Outreach Studio password reset link",
        f"Hi {user.name or 'there'},\n\nWe received a request to reset your Outreach Studio password. Use this secure link within 2 minutes:\n{reset_url}\n\nIf you did not request this, you can safely ignore this email.",
        f'''<!doctype html><html><body style="margin:0;padding:0;background:#f4f7fb;font-family:Inter,Arial,sans-serif;color:#172554;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:36px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe5f1;border-radius:20px;overflow:hidden;">
<tr><td style="padding:26px 32px;background:linear-gradient(135deg,#eef2ff,#eff6ff);border-bottom:1px solid #dbe5f1;"><div style="display:inline-block;padding:7px 10px;border:1px solid #c7d2fe;border-radius:8px;color:#4338ca;background:#ffffff;font-size:11px;font-weight:800;letter-spacing:1.4px;">OUTREACH STUDIO</div><h1 style="margin:18px 0 0;font-size:26px;line-height:1.2;letter-spacing:-.5px;">Reset your password</h1></td></tr>
<tr><td style="padding:30px 32px 18px;"><p style="margin:0 0 15px;font-size:15px;line-height:1.65;color:#334155;">Hi {safe_name},</p><p style="margin:0;font-size:15px;line-height:1.65;color:#475569;">We received a request to reset your password. Use the secure button below to choose a new one.</p><table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0;"><tr><td style="border-radius:10px;background:#4f46e5;"><a href="{safe_url}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Reset password&nbsp; →</a></td></tr></table><div style="padding:13px 14px;border:1px solid #dbeafe;border-radius:10px;background:#f8fbff;color:#475569;font-size:13px;line-height:1.55;"><strong style="color:#1e3a8a;">This link expires in 2 minutes.</strong><br />For your security, it can only be used once.</div><p style="margin:23px 0 0;font-size:12px;line-height:1.6;color:#64748b;">If you did not request this change, you can safely ignore this email. Your password will remain unchanged.</p></td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #eef2f7;background:#fbfcfe;color:#94a3b8;font-size:11px;line-height:1.5;">Outreach Studio · Secure account recovery</td></tr>
</table></td></tr></table></body></html>''',
    )


@router.post("/forgot-password", status_code=202)
def forgot_password(data: ForgotPassword, db=Depends(get_db)):
    # Always return the same response so the endpoint cannot be used to discover accounts.
    user = db.scalar(select(User).where(User.email == str(data.email).lower()))
    if not user:
        return {"ok": True}
    raw_token = secrets.token_urlsafe(48)
    for item in db.scalars(
        select(PasswordResetToken).where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
    ):
        item.used_at = now()
    db.add(PasswordResetToken(
        user_id=user.id,
        token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
        expires_at=now() + timedelta(minutes=2),
    ))
    db.commit()
    try:
        send_reset_email(user, raw_token)
        audit(db, user, "auth.password_reset_requested", user.id)
        db.commit()
    except Exception:
        # Do not expose account or sender details from a public recovery endpoint.
        # Keep the public response generic, but make delivery failures visible to
        # operators instead of silently losing a password-reset email.
        logger.exception("Password reset email delivery failed")
        return {"ok": True}
    return {"ok": True}


@router.get("/reset-password/validate")
def validate_reset_password_token(token: str, db=Depends(get_db)):
    item = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == hashlib.sha256(token.encode()).hexdigest()
        )
    )
    return {"valid": bool(item and not item.used_at and item.expires_at > now())}


@router.post("/reset-password")
def reset_password(data: ResetPassword, db=Depends(get_db)):
    item = db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == hashlib.sha256(data.token.encode()).hexdigest())
        .with_for_update()
    )
    if not item or item.used_at or item.expires_at <= now():
        raise HTTPException(400, "This password reset link is invalid or has expired")
    user = db.get(User, item.user_id)
    if not user:
        raise HTTPException(400, "This password reset link is invalid or has expired")
    if passwords.verify(data.password, user.password_hash):
        raise HTTPException(422, "New password must be different from your current password")
    user.password_hash = passwords.hash(data.password)
    user.token_version += 1
    item.used_at = now()
    for session in db.scalars(select(RefreshSession).where(RefreshSession.user_id == user.id, RefreshSession.revoked.is_(False))):
        session.revoked = True
    audit(db, user, "auth.password_reset", user.id)
    db.commit()
    return {"ok": True}


@router.post("/refresh")
def refresh(data: Refresh, db=Depends(get_db)):
    session = db.scalar(
        select(RefreshSession)
        .where(RefreshSession.token_hash == hashlib.sha256(data.refresh_token.encode()).hexdigest())
        .with_for_update()
    )
    if not session or session.revoked or session.expires_at <= now():
        raise HTTPException(401, "Invalid refresh token")
    return tokens(db, db.get(User, session.user_id), data.refresh_token)


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
