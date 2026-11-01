from celery import Celery
from app.core.config import get_settings

celery = Celery(
    "mailforge",
    broker=get_settings().redis_url,
    backend=get_settings().redis_url,
    include=["app.workers.tasks"],
)
celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    beat_schedule={"dispatch": {"task": "app.workers.tasks.dispatch", "schedule": 5.0}},
)
