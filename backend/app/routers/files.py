from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import FileAsset, Project
from app.schemas.entities import FileRead
from app.services.storage import extract_text, save_upload

router = APIRouter(tags=["files"])


@router.post("/api/projects/{project_id}/files", response_model=FileRead)
async def upload_file(project_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
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
def list_files(project_id: int, db: Session = Depends(get_db)):
    return db.query(FileAsset).filter(FileAsset.project_id == project_id).order_by(FileAsset.created_at.desc()).all()


@router.get("/api/files/{file_id}", response_model=FileRead)
def get_file(file_id: int, db: Session = Depends(get_db)):
    asset = db.get(FileAsset, file_id)
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")
    return asset
