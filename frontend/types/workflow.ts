export type ProviderType = "openai_compatible" | "deepseek" | "anthropic" | "custom" | "mock";

export type NodeRunStatus = "pending" | "running" | "success" | "error" | "skipped" | "stopped";

export type Project = {
  id: number;
  owner_user_id?: number | null;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type User = {
  id: number;
  username: string;
  display_name: string;
  created_at: string;
};

export type AuthResponse = {
  token: string;
  user: User;
};

export type ApiProvider = {
  id: number;
  project_id: number;
  name: string;
  description: string;
  provider_type: ProviderType;
  base_url: string;
  model_name: string;
  temperature: number;
  max_tokens: number;
  enabled: boolean;
  api_key_masked: string;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
};

export type ProviderTestResult = {
  status: "success" | "error" | string;
  content: string;
  error: string | null;
  request_url?: string | null;
  status_code?: number | null;
  duration_ms?: number | null;
  provider_name?: string | null;
  model_name?: string | null;
  raw?: unknown;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
};

export type ProviderChatResult = ProviderTestResult;

export type FileAsset = {
  id: number;
  project_id: number;
  filename: string;
  original_name: string;
  path: string;
  mime_type: string;
  extracted_text: string;
  created_at: string;
};

export type WorkflowNodeData = {
  label: string;
  icon?: string;
  node_type?: string;
  runtime_type?: string;
  description?: string;
  status?: NodeRunStatus;
  config: Record<string, unknown>;
};

export type WorkflowNode = {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  data?: WorkflowNodeData;
  config?: Record<string, unknown>;
  inputs: unknown[];
  outputs: unknown[];
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  source_handle?: string | null;
  target_handle?: string | null;
  condition?: unknown;
  transfer_mode?: string;
  selected_paths?: unknown[];
};

export type WorkflowJson = {
  id: string;
  name: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type Workflow = {
  id: number;
  project_id: number;
  name: string;
  description: string;
  workflow_json: WorkflowJson;
  created_at: string;
  updated_at: string;
};

export type WorkflowRun = {
  id: number;
  project_id: number;
  workflow_id: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  final_output: Record<string, unknown> | null;
};

export type WorkflowRunStep = {
  id: number;
  run_id: number;
  node_id: string;
  node_type: string;
  status: string;
  input_json: Record<string, unknown> | null;
  output_json: Record<string, unknown> | null;
  error_message: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number;
};
