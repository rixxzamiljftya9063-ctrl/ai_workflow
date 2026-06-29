import type { ApiProvider, ChatMessage, FileAsset, Project, ProviderChatResult, ProviderTestResult, Workflow, WorkflowRun, WorkflowRunStep } from "@/types/workflow";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export class ApiRequestError extends Error {
  path: string;
  status: number;
  cause?: unknown;

  constructor(message: string, path: string, status = 0, cause?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.path = path;
    this.status = status;
    this.cause = cause;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers || {}) },
      cache: "no-store"
    });
  } catch (error) {
    throw new ApiRequestError(`无法连接后端 API：${url}。请确认后端服务已启动在 ${API_BASE}。`, path, 0, error);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const text = await response.text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as { detail?: unknown };
          detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed);
        } catch {
          detail = text;
        }
      }
    } catch {}
    throw new ApiRequestError(`接口请求失败：${path}（HTTP ${response.status}）\n${detail}`, path, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ApiRequestError(`接口返回不是合法 JSON：${path}`, path, response.status, error);
  }
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  projects: () => request<Project[]>("/api/projects"),
  createProject: (body: { name: string; description: string }) => request<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  deleteProject: (id: number) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  project: (id: number) => request<Project>(`/api/projects/${id}`),
  providers: (projectId: number) => request<ApiProvider[]>(`/api/projects/${projectId}/providers`),
  createProvider: (projectId: number, body: Record<string, unknown>) =>
    request<ApiProvider>(`/api/projects/${projectId}/providers`, { method: "POST", body: JSON.stringify(body) }),
  updateProvider: (id: number, body: Record<string, unknown>) => request<ApiProvider>(`/api/providers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProvider: (id: number) => request<{ ok: boolean }>(`/api/providers/${id}`, { method: "DELETE" }),
  testProvider: (id: number) => request<ProviderTestResult>(`/api/providers/${id}/test`, { method: "POST" }),
  chatProvider: (id: number, body: { message: string; history?: ChatMessage[]; system_prompt?: string }) =>
    request<ProviderChatResult>(`/api/providers/${id}/chat`, { method: "POST", body: JSON.stringify(body) }),
  files: (projectId: number) => request<FileAsset[]>(`/api/projects/${projectId}/files`),
  uploadFile: (projectId: number, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<FileAsset>(`/api/projects/${projectId}/files`, { method: "POST", body });
  },
  workflows: (projectId: number) => request<Workflow[]>(`/api/projects/${projectId}/workflows`),
  workflow: (id: number) => request<Workflow>(`/api/workflows/${id}`),
  createWorkflow: (projectId: number, body: Record<string, unknown>) =>
    request<Workflow>(`/api/projects/${projectId}/workflows`, { method: "POST", body: JSON.stringify(body) }),
  updateWorkflow: (id: number, body: Record<string, unknown>) => request<Workflow>(`/api/workflows/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteWorkflow: (id: number) => request<{ ok: boolean }>(`/api/workflows/${id}`, { method: "DELETE" }),
  runWorkflow: (id: number, body?: Record<string, unknown>, signal?: AbortSignal) => request<WorkflowRun>(`/api/workflows/${id}/run`, { method: "POST", body: JSON.stringify(body || {}), signal }),
  runWorkflowAsync: (id: number, body?: Record<string, unknown>, signal?: AbortSignal) => request<WorkflowRun>(`/api/workflows/${id}/run-async`, { method: "POST", body: JSON.stringify(body || {}), signal }),
  runWorkflowNode: (workflowId: number, nodeId: string, signal?: AbortSignal) => request<WorkflowRun>(`/api/workflows/${workflowId}/run-node/${encodeURIComponent(nodeId)}`, { method: "POST", signal }),
  runWorkflowNodeAsync: (workflowId: number, nodeId: string, signal?: AbortSignal) => request<WorkflowRun>(`/api/workflows/${workflowId}/run-node/${encodeURIComponent(nodeId)}/async`, { method: "POST", signal }),
  stopWorkflow: (id: number) => request<{ ok: boolean; stopped_runs: number[] }>(`/api/workflows/${id}/stop`, { method: "POST" }),
  stopRun: (id: number) => request<{ ok: boolean; run_id: number }>(`/api/runs/${id}/stop`, { method: "POST" }),
  projectRuns: (projectId: number) => request<WorkflowRun[]>(`/api/projects/${projectId}/runs`),
  run: (id: number) => request<WorkflowRun>(`/api/runs/${id}`),
  runSteps: (id: number) => request<WorkflowRunStep[]>(`/api/runs/${id}/steps`),
  importWorkflow: (projectId: number, body: Record<string, unknown>) =>
    request<Workflow>(`/api/projects/${projectId}/workflows/import`, { method: "POST", body: JSON.stringify(body) }),
  exportWorkflowUrl: (id: number) => `${API_BASE}/api/workflows/${id}/export`
};
