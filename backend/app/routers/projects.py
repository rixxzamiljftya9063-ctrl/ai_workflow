from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import Project, User
from app.schemas.entities import ProjectCreate, ProjectRead, ProjectUpdate
from app.services.auth import current_user
from app.services.ownership import require_project

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
def list_projects(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(Project).filter(Project.owner_user_id == user.id).order_by(Project.updated_at.desc()).all()


@router.post("", response_model=ProjectRead)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    project = Project(name=payload.name, description=payload.description, owner_user_id=user.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return require_project(db, project_id, user)


@router.put("/{project_id}", response_model=ProjectRead)
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    project = require_project(db, project_id, user)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, key, value)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    project = require_project(db, project_id, user)
    db.delete(project)
    db.commit()
    return {"ok": True}
