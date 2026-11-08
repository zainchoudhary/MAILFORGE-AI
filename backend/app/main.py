import logging
import time
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from app.core.config import get_settings
from app.database.session import SessionLocal
from app.api.v1 import auth, resources, campaigns, intelligence, public, lead_finder, linkedin_capture

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("mailforge")
s = get_settings()


@asynccontextmanager
async def lifespan(app):
    app.state.redis = Redis.from_url(s.redis_url) if s.redis_url else None
    yield
    if app.state.redis:
        await app.state.redis.aclose()


app = FastAPI(
    title="Outreach Studio",
    version="1.0.0",
    lifespan=lifespan,
    description="Traceable email operations with explicit approval and safe delivery semantics.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=s.cors_origins.split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Mailforge-Signature"],
)


@app.middleware("http")
async def controls(request: Request, call_next):
    identifier = str(uuid.uuid4())
    if (
        request.headers.get("content-length", "0").isdigit()
        and int(request.headers.get("content-length", "0")) > s.max_attachment_bytes + 1000000
    ):
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    if request.url.path.startswith("/api/") and request.method != "OPTIONS":
        host = request.client.host if request.client else "unknown"
        auth_path = request.url.path.startswith("/api/v1/auth/")
        key = f"api:{host}:{'auth' if auth_path else 'all'}:{int(time.time() // 60)}"
        try:
            if request.app.state.redis is None:
                return await call_next(request)
            count = await request.app.state.redis.incr(key)
            if count == 1:
                await request.app.state.redis.expire(key, 65)
            if count > (20 if auth_path else 240):
                return JSONResponse(
                    {"detail": "Rate limit exceeded"},
                    status_code=429,
                    headers={"Retry-After": "60"},
                )
        except Exception:
            return JSONResponse({"detail": "Rate limiting service unavailable"}, status_code=503)
    response = await call_next(request)
    response.headers["X-Request-ID"] = identifier
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.exception_handler(IntegrityError)
async def conflict(request, error):
    return JSONResponse({"detail": "Record conflicts with an existing record"}, status_code=409)


@app.exception_handler(Exception)
async def unexpected(request, error):
    logger.exception("Unhandled request error", exc_info=error)
    return JSONResponse(
        {"detail": "Unexpected server error; inspect server logs with the request time"},
        status_code=500,
    )


@app.get("/health")
def health():
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ok", "dry_run": s.dry_run}
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)


for router in (auth.router, resources.router, campaigns.router, intelligence.router, public.router, lead_finder.router, linkedin_capture.router):
    app.include_router(router, prefix="/api/v1")
