from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()


def normalize_database_url(url: str) -> str:
    url = (url or "").strip() or settings.sqlite_fallback_database_url
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


database_url = normalize_database_url(settings.database_url)
if database_url.startswith("sqlite:///"):
    db_file = database_url.replace("sqlite:///", "", 1)
    Path(db_file).parent.mkdir(parents=True, exist_ok=True)

connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.models.entities import (  # noqa: F401
        ApiProvider,
        FileAsset,
        Project,
        User,
        UserSession,
        Workflow,
        WorkflowRun,
        WorkflowRunStep,
    )

    Base.metadata.create_all(bind=engine)
    migrate_sqlite_schema()


def migrate_sqlite_schema() -> None:
    if not database_url.startswith("sqlite"):
        return
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "api_providers" not in table_names:
        return
    with engine.begin() as connection:
        columns = {column["name"] for column in inspector.get_columns("api_providers")}
        if "description" not in columns:
            connection.execute(text("ALTER TABLE api_providers ADD COLUMN description TEXT DEFAULT ''"))
        if "projects" in table_names:
            project_columns = {column["name"] for column in inspector.get_columns("projects")}
            if "owner_user_id" not in project_columns:
                connection.execute(text("ALTER TABLE projects ADD COLUMN owner_user_id INTEGER"))
