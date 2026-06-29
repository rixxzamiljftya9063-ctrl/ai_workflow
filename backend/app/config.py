from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    backend_port: int = 8000
    frontend_origin: str = "http://127.0.0.1:3000"
    database_url: str = "sqlite:///./storage/ai_workflow.db"
    sqlite_fallback_database_url: str = "sqlite:///./storage/ai_workflow.db"
    storage_root: str = "./storage"
    default_mock_provider: str = "Mock Provider"
    request_timeout_seconds: int = 180
    provider_retry_max_attempts: int = 5
    provider_retry_base_delay_seconds: float = 1.0
    provider_retry_max_delay_seconds: float = 8.0

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def storage_path(self) -> Path:
        return Path(self.storage_root).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
