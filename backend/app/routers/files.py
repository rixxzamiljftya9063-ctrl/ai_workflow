from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import FileAsset, User
from app.schemas.entities import FileRead
from app.services.auth import current_user
from app.services.ownership import require_file, require_project
from app.services.storage import extract_text, save_upload

router = APIRouter(tags=["files"])


@router.post("/api/projects/{project_id}/files", response_model=FileRead)
async def upload_file(project_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_project(db, project_id, user)
    try:
        filename, path, content = await save_upload(project_id, file)
        extracted = extract_text(path, content, file.content_type or "")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Upload failed: {exc}") from exc
    asset = FileAsset(
        project_id=project_id,
        filename=filename,
        original_name=file.filename or filename,
        path=str(path),
        mime_type=file.content_type or "",
        extracted_text=extracted,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.get("/api/projects/{project_id}/files", response_model=list[FileRead])
def list_files(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_project(db, project_id, user)
    return db.query(FileAsset).filter(FileAsset.project_id == project_id).order_by(FileAsset.created_at.desc()).all()


@router.get("/api/files/{file_id}", response_model=FileRead)
def get_file(file_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return require_file(db, file_id, user)
