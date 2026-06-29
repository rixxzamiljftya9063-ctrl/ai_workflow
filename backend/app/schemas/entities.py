from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


ProviderType = Literal["openai_compatible", "deepseek", "anthropic", "custom", "mock"]


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class ProjectRead(ProjectBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ApiProviderBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    provider_type: ProviderType = "mock"
    base_url: str = ""
    model_name: str = ""
    temperature: float = 0.7
    max_tokens: int = 1200
    enabled: bool = True


class ApiProviderCreate(ApiProviderBase):
    api_key: str = ""


class ApiProviderUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    provider_type: ProviderType | None = None
    base_url: str | None = None
    api_key: str | None = None
    model_name: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    enabled: bool | None = None


class ApiProviderRead(ApiProviderBase):
    id: int
    project_id: int
    api_key_masked: str
    has_api_key: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ApiProviderChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    history: list[ChatMessage] = Field(default_factory=list)
    system_prompt: str = ""


class WorkflowBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    workflow_json: dict[str, Any] = Field(default_factory=dict)


class WorkflowCreate(WorkflowBase):
    template: str | None = None


class WorkflowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    workflow_json: dict[str, Any] | None = None


class WorkflowRead(WorkflowBase):
    id: int
    project_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FileRead(BaseModel):
    id: int
    project_id: int
    filename: str
    original_name: str
    path: str
    mime_type: str
    extracted_text: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkflowRunRead(BaseModel):
    id: int
    project_id: int
    workflow_id: int
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    final_output: dict[str, Any] | None

    model_config = ConfigDict(from_attributes=True)


class WorkflowRunStepRead(BaseModel):
    id: int
    run_id: int
    node_id: str
    node_type: str
    status: str
    input_json: dict[str, Any] | None
    output_json: dict[str, Any] | None
    error_message: str
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int

    model_config = ConfigDict(from_attributes=True)


class WorkflowImportRequest(BaseModel):
    name: str | None = None
    workflow_json: dict[str, Any]
