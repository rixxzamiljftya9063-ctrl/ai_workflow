from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import ApiProvider, User
from app.schemas.entities import ApiProviderChatRequest, ApiProviderCreate, ApiProviderRead, ApiProviderUpdate
from app.services.auth import current_user
from app.services.ownership import require_project, require_provider
from app.services.provider_client import ProviderClient
from app.services.security import mask_api_key

router = APIRouter(tags=["providers"])


def serialize(provider: ApiProvider) -> ApiProviderRead:
    data = {
        "id": provider.id,
        "project_id": provider.project_id,
        "name": provider.name,
        "description": provider.description or "",
        "provider_type": provider.provider_type,
        "base_url": provider.base_url,
        "model_name": provider.model_name,
        "temperature": provider.temperature,
        "max_tokens": provider.max_tokens,
        "enabled": provider.enabled,
        "api_key_masked": mask_api_key(provider.api_key),
        "has_api_key": bool(provider.api_key),
        "created_at": provider.created_at,
        "updated_at": provider.updated_at,
    }
    return ApiProviderRead(**data)


@router.get("/api/projects/{project_id}/providers", response_model=list[ApiProviderRead])
def list_providers(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_project(db, project_id, user)
    return [serialize(item) for item in db.query(ApiProvider).filter(ApiProvider.project_id == project_id).all()]


@router.post("/api/projects/{project_id}/providers", response_model=ApiProviderRead)
def create_provider(project_id: int, payload: ApiProviderCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_project(db, project_id, user)
    provider = ApiProvider(project_id=project_id, **payload.model_dump())
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return serialize(provider)


@router.put("/api/providers/{provider_id}", response_model=ApiProviderRead)
def update_provider(provider_id: int, payload: ApiProviderUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    provider = require_provider(db, provider_id, user)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("api_key") == "":
        updates.pop("api_key")
    for key, value in updates.items():
        setattr(provider, key, value)
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return serialize(provider)


@router.delete("/api/providers/{provider_id}")
def delete_provider(provider_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    provider = require_provider(db, provider_id, user)
    db.delete(provider)
    db.commit()
    return {"ok": True}


@router.post("/api/providers/{provider_id}/test")
async def test_provider(provider_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    provider = require_provider(db, provider_id, user)
    result = await ProviderClient().test(provider)
    return {
        "status": result.status,
        "content": result.content,
        "error": result.error,
        "request_url": result.request_url,
        "status_code": result.status_code,
        "duration_ms": result.duration_ms,
        "provider_name": result.provider_name or provider.name,
        "model_name": result.model_name or provider.model_name,
        "raw": result.raw,
    }


@router.post("/api/providers/{provider_id}/chat")
async def chat_provider(provider_id: int, payload: ApiProviderChatRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    provider = require_provider(db, provider_id, user)
    result = await ProviderClient().chat(
        provider,
        payload.message,
        [item.model_dump() for item in payload.history],
        payload.system_prompt,
    )
    return {
        "status": result.status,
        "content": result.content,
        "error": result.error,
        "request_url": result.request_url,
        "status_code": result.status_code,
        "duration_ms": result.duration_ms,
        "provider_name": result.provider_name or provider.name,
        "model_name": result.model_name or provider.model_name,
        "raw": result.raw,
    }
