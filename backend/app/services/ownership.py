from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.entities import ApiProvider, FileAsset, Project, User, Workflow, WorkflowRun


def require_project(db: Session, project_id: int, user: User) -> Project:
    project = db.get(Project, project_id)
    if not project or project.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def require_provider(db: Session, provider_id: int, user: User) -> ApiProvider:
    provider = db.get(ApiProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    require_project(db, provider.project_id, user)
    return provider


def require_workflow(db: Session, workflow_id: int, user: User) -> Workflow:
    workflow = db.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    require_project(db, workflow.project_id, user)
    return workflow


def require_file(db: Session, file_id: int, user: User) -> FileAsset:
    asset = db.get(FileAsset, file_id)
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")
    require_project(db, asset.project_id, user)
    return asset


def require_run(db: Session, run_id: int, user: User) -> WorkflowRun:
    run = db.get(WorkflowRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project(db, run.project_id, user)
    return run
