from typing import Any

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models.entities import User, Workflow, WorkflowRun, WorkflowRunStep
from app.schemas.entities import WorkflowRunRead, WorkflowRunStepRead
from app.services.auth import current_user
from app.services.ownership import require_project, require_run, require_workflow
from app.workflow.control import request_run_stop, request_workflow_stop
from app.workflow.runner import WorkflowRunner

router = APIRouter(tags=["runs"])


@router.post("/api/workflows/{workflow_id}/run", response_model=WorkflowRunRead)
async def run_workflow(workflow_id: int, payload: dict[str, Any] | None = Body(default=None), db: Session = Depends(get_db), user: User = Depends(current_user)):
    workflow = require_workflow(db, workflow_id, user)
    # The MVP runner currently reads node configs as its source of inputs.
    # Accepting a payload keeps the API shape ready for embedded callers.
    _ = payload
    return await WorkflowRunner(db).run(workflow)


async def execute_workflow_background(workflow_id: int, run_id: int) -> None:
    db = SessionLocal()
    try:
        workflow = db.get(Workflow, workflow_id)
        run = db.get(WorkflowRun, run_id)
        if not workflow or not run:
            return
        await WorkflowRunner(db).execute_run_record(workflow, run)
    finally:
        db.close()


async def execute_workflow_node_background(workflow_id: int, run_id: int, node_id: str) -> None:
    db = SessionLocal()
    try:
        workflow = db.get(Workflow, workflow_id)
        run = db.get(WorkflowRun, run_id)
        if not workflow or not run:
            return
        await WorkflowRunner(db).execute_node_run_record(workflow, run, node_id)
    finally:
        db.close()


@router.post("/api/workflows/{workflow_id}/run-async", response_model=WorkflowRunRead)
async def run_workflow_async(
    workflow_id: int,
    background_tasks: BackgroundTasks,
    payload: dict[str, Any] | None = Body(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    workflow = require_workflow(db, workflow_id, user)
    _ = payload
    run = WorkflowRunner(db).create_run_record(workflow)
    background_tasks.add_task(execute_workflow_background, workflow.id, run.id)
    return run


@router.post("/api/workflows/{workflow_id}/run-node/{node_id}/async", response_model=WorkflowRunRead)
async def run_workflow_node_async(workflow_id: int, node_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    workflow = require_workflow(db, workflow_id, user)
    run = WorkflowRunner(db).create_run_record(workflow)
    background_tasks.add_task(execute_workflow_node_background, workflow.id, run.id, node_id)
    return run


@router.post("/api/workflows/{workflow_id}/run-node/{node_id}", response_model=WorkflowRunRead)
async def run_workflow_node(workflow_id: int, node_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    workflow = require_workflow(db, workflow_id, user)
    return await WorkflowRunner(db).run_node(workflow, node_id)


@router.post("/api/workflows/{workflow_id}/stop")
def stop_workflow(workflow_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    workflow = require_workflow(db, workflow_id, user)
    request_workflow_stop(workflow_id)
    active_runs = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.workflow_id == workflow_id, WorkflowRun.status == "running")
        .all()
    )
    for run in active_runs:
        request_run_stop(run.id)
    return {"ok": True, "stopped_runs": [run.id for run in active_runs]}


@router.post("/api/runs/{run_id}/stop")
def stop_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    run = require_run(db, run_id, user)
    request_run_stop(run_id)
    return {"ok": True, "run_id": run_id}


@router.get("/api/runs/{run_id}", response_model=WorkflowRunRead)
def get_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return require_run(db, run_id, user)


@router.get("/api/runs/{run_id}/steps", response_model=list[WorkflowRunStepRead])
def get_run_steps(run_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_run(db, run_id, user)
    return db.query(WorkflowRunStep).filter(WorkflowRunStep.run_id == run_id).order_by(WorkflowRunStep.id.asc()).all()


@router.get("/api/projects/{project_id}/runs", response_model=list[WorkflowRunRead])
def list_project_runs(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_project(db, project_id, user)
    return db.query(WorkflowRun).filter(WorkflowRun.project_id == project_id).order_by(WorkflowRun.id.desc()).all()
