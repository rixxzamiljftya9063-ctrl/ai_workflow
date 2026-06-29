from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import User, UserSession
from app.schemas.entities import AuthRequest, AuthResponse, UserRead
from app.services.auth import create_session, current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse)
def register(payload: AuthRequest, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(
        username=username,
        display_name=payload.display_name.strip() or username,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_session(db, user)
    return AuthResponse(token=token, user=UserRead.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: AuthRequest, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_session(db, user)
    return AuthResponse(token=token, user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(current_user)):
    return user


@router.post("/logout")
def logout(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(UserSession).filter(UserSession.user_id == user.id).delete()
    db.commit()
    return {"ok": True}
