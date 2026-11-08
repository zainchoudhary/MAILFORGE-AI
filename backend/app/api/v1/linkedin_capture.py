from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.linkedin_capture import service
from app.linkedin_capture.schemas import (
    CaptureCandidatePatch,
    CaptureJobsBatchInput,
    CaptureRunInput,
    CaptureSaveGroupInput,
    ExtractInput,
    FetchDetailsInput,
)
from app.security.auth import current_user, editor

router = APIRouter(prefix="/linkedin-capture", tags=["LinkedIn Capture"])


@router.post("/runs", status_code=201)
def create_run(data: CaptureRunInput, user=Depends(editor), db=Depends(get_db)):
    run = service.create_run(
        db, user, search_url=data.search_url, search_query_snapshot=data.search_query_snapshot
    )
    return service.run_payload(db, run)


@router.get("/runs")
def list_runs(user=Depends(current_user), db=Depends(get_db)):
    return service.list_runs(db, user)


@router.get("/runs/{run_id}")
def get_run(run_id: str, user=Depends(current_user), db=Depends(get_db)):
    return service.get_run(db, user, run_id)


@router.post("/runs/{run_id}/jobs/batch")
def upsert_jobs_batch(
    run_id: str, data: CaptureJobsBatchInput, user=Depends(editor), db=Depends(get_db)
):
    jobs = [j.model_dump() for j in data.jobs]
    return service.upsert_jobs_batch(db, user, run_id, jobs, extract=data.extract)


@router.get("/runs/{run_id}/jobs")
def list_jobs(
    run_id: str,
    page_number: int = Query(1, ge=1, alias="page"),
    limit: int = Query(100, ge=1, le=200),
    user=Depends(current_user),
    db=Depends(get_db),
):
    return service.list_jobs(db, user, run_id, page_number, limit)


@router.post("/runs/{run_id}/jobs/fetch-details")
def fetch_details(
    run_id: str, data: FetchDetailsInput, user=Depends(editor), db=Depends(get_db)
):
    return service.request_fetch_details(db, user, run_id, data.job_ids)


@router.post("/runs/{run_id}/extract")
def extract(run_id: str, data: ExtractInput, user=Depends(editor), db=Depends(get_db)):
    return service.extract_run(db, user, run_id, job_raw_ids=data.job_raw_ids)


@router.get("/runs/{run_id}/candidates")
def list_candidates(
    run_id: str,
    page_number: int = Query(1, ge=1, alias="page"),
    limit: int = Query(100, ge=1, le=200),
    user=Depends(current_user),
    db=Depends(get_db),
):
    return service.list_candidates(db, user, run_id, page_number, limit)


@router.patch("/runs/{run_id}/candidates/{candidate_id}")
def patch_candidate(
    run_id: str,
    candidate_id: str,
    data: CaptureCandidatePatch,
    user=Depends(editor),
    db=Depends(get_db),
):
    return service.patch_candidate(
        db, user, run_id, candidate_id, data.model_dump(exclude_unset=True)
    )


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, user=Depends(editor), db=Depends(get_db)):
    return service.run_payload(db, service.cancel_run(db, user, run_id))


@router.post("/runs/{run_id}/save-group", status_code=201)
def save_group(
    run_id: str, data: CaptureSaveGroupInput, user=Depends(editor), db=Depends(get_db)
):
    return service.save_group(db, user, run_id, data.group_name, data.candidate_ids)
