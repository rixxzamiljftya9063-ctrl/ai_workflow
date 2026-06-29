from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import ApiProvider, Project, Workflow
from app.schemas.entities import WorkflowCreate, WorkflowImportRequest, WorkflowRead, WorkflowUpdate
from app.services.security import sanitize_payload
from app.workflow.templates import empty_workflow, modeling_template

router = APIRouter(tags=["workflows"])


@router.get("/api/projects/{project_id}/workflows", response_model=list[WorkflowRead])
def list_workflows(project_id: int, db: Session = Depends(get_db)):
    return db.query(Workflow).filter(Workflow.project_id == project_id).order_by(Workflow.updated_at.desc()).all()


@router.post("/api/projects/{project_id}/workflows", response_model=WorkflowRead)
def create_workflow(project_id: int, payload: WorkflowCreate, db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    workflow_json = payload.workflow_json or empty_workflow(payload.name)
    if payload.template == "math_modeling_cross_review":
        providers = db.query(ApiProvider).filter(ApiProvider.project_id == project_id, ApiProvider.enabled == True).all()  # noqa: E712
        workflow_json = modeling_template([provider.id for provider in providers])
    workflow = Workflow(project_id=project_id, name=payload.name, description=payload.description, workflow_json=workflow_json)
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    if workflow.workflow_json.get("id") in {"draft", "math-modeling-template"}:
        workflow.workflow_json["id"] = str(workflow.id)
        db.add(workflow)
        db.commit()
        db.refresh(workflow)
    return workflow


@router.get("/api/workflows/{workflow_id}", response_model=WorkflowRead)
def get_workflow(workflow_id: int, db: Session = Depends(get_db)):
    workflow = db.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@router.put("/api/workflows/{workflow_id}", response_model=WorkflowRead)
def update_workflow(workflow_id: int, payload: WorkflowUpdate, db: Session = Depends(get_db)):
    workflow = db.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(workflow, key, value)
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return workflow


@router.delete("/api/workflows/{workflow_id}")
def delete_workflow(workflow_id: int, db: Session = Depends(get_db)):
    workflow = db.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    db.delete(workflow)
    db.commit()
    return {"ok": True}


@router.get("/api/workflows/{workflow_id}/export")
def export_workflow(workflow_id: int, db: Session = Depends(get_db)):
    workflow = db.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    required_providers = []
    for node in workflow.workflow_json.get("nodes", []):
        node_data = node.get("data") or {}
        config = node_data.get("config") or node.get("config") or {}
        for key in ("provider_id",):
            if config.get(key):
                required_providers.append({"provider_id": config[key], "node_id": node.get("id")})
        for provider_id in config.get("provider_ids") or config.get("reviewer_provider_ids") or []:
            required_providers.append({"provider_id": provider_id, "node_id": node.get("id")})
    payload = sanitize_payload(
        {
            **workflow.workflow_json,
            "required_providers": required_providers,
            "io_notes": "Configure providers in your runtime, then pass input files or text through file_input/text_input nodes.",
            "security_note": "API keys are not included. Configure providers in your runtime environment.",
        }
    )
    return JSONResponse(payload, headers={"Content-Disposition": f'attachment; filename="workflow-{workflow.id}.json"'})


@router.post("/api/projects/{project_id}/workflows/import", response_model=WorkflowRead)
def import_workflow(project_id: int, payload: WorkflowImportRequest, db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    workflow_json = sanitize_payload(payload.workflow_json)
    workflow_json.pop("api_key", None)
    name = payload.name or workflow_json.get("name") or "Imported workflow"
    workflow = Workflow(project_id=project_id, name=name, description="Imported from workflow.json", workflow_json=workflow_json)
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return workflow
