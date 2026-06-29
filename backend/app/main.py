from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import init_db
from app.routers import auth, files, projects, providers, runs, workflows

settings = get_settings()

app = FastAPI(title="AI Workflow Builder API", version="0.1.0")
settings.storage_path.mkdir(parents=True, exist_ok=True)
projects_storage_path = settings.storage_path / "projects"
projects_storage_path.mkdir(parents=True, exist_ok=True)
app.mount("/storage/projects", StaticFiles(directory=str(projects_storage_path)), name="project-storage")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_origin,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(projects.router)
app.include_router(auth.router)
app.include_router(providers.router)
app.include_router(workflows.router)
app.include_router(files.router)
app.include_router(runs.router)
