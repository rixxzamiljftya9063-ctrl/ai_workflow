import type { Edge, Node } from "@xyflow/react";
import type { NodeRunStatus, WorkflowEdge, WorkflowJson, WorkflowNode } from "@/types/workflow";

export type NodeCategory = "core" | "input" | "ai" | "logic" | "data" | "tool" | "output" | "check";

export type NodeCatalogItem = {
  type: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  category: NodeCategory;
  implementedAs?: string;
};

export const nodeCategories: { id: NodeCategory; label: string }[] = [
  { id: "core", label: "核心模块" },
  { id: "input", label: "输入节点" },
  { id: "ai", label: "AI 节点" },
  { id: "logic", label: "逻辑节点" },
  { id: "data", label: "数据节点" },
  { id: "tool", label: "工具节点" },
  { id: "output", label: "输出节点" },
  { id: "check", label: "检查节点" }
];

export const nodeCatalog: NodeCatalogItem[] = [
  { type: "start", label: "开始 / 资料入口", icon: "FileUp", color: "#0f766e", description: "工作流入口，默认汇总项目全部资料并沿箭头传给后续节点", category: "core" },
  { type: "chat", label: "对话窗口", icon: "MessageCircle", color: "#0891b2", description: "与已配置 API / 智能体直接对话，并把对话记录作为节点输出", category: "core" },
  { type: "api_call", label: "API 调用", icon: "Bot", color: "#2563eb", description: "选择 API 密钥和提示词，完整输出后传给下个节点", category: "core", implementedAs: "llm_call" },
  { type: "skill", label: "技能 / 节点工作流", icon: "FileText", color: "#0f766e", description: "用 Markdown 技能指令处理上游 API 的完整输出", category: "core" },
  { type: "cross_review", label: "交叉验证", icon: "GitCompare", color: "#dc2626", description: "接收多个输入，分类比较不同 API 和技能节点结果", category: "core" },

  { type: "text_input", label: "文本输入", icon: "Type", color: "#0f766e", description: "手动输入一段文本或任务要求", category: "input" },
  { type: "file_input", label: "文件输入", icon: "FileUp", color: "#2563eb", description: "上传或选择项目文件", category: "input" },
  { type: "form_input", label: "表单输入", icon: "ListChecks", color: "#0d9488", description: "用表单收集结构化参数", category: "input" },
  { type: "url_input", label: "网页输入", icon: "Link", color: "#0284c7", description: "输入网页链接作为数据来源", category: "input" },
  { type: "variable_input", label: "变量输入", icon: "Braces", color: "#475569", description: "读取工作流变量", category: "input" },

  { type: "llm_call", label: "兼容 AI 调用", icon: "Bot", color: "#4f46e5", description: "兼容旧工作流的单模型调用", category: "ai" },
  { type: "parallel_llm", label: "多模型并行", icon: "Network", color: "#7c3aed", description: "让多个模型同时处理同一任务", category: "ai" },
  { type: "consensus_merge", label: "共识合并", icon: "Combine", color: "#6366f1", description: "合并多个模型的可靠结论", category: "ai", implementedAs: "merge" },
  { type: "prompt_router", label: "提示词路由", icon: "Route", color: "#8b5cf6", description: "根据条件选择不同提示词", category: "ai", implementedAs: "llm_call" },

  { type: "condition", label: "条件判断", icon: "GitBranch", color: "#ca8a04", description: "根据条件决定下一步", category: "logic" },
  { type: "switch", label: "多分支", icon: "Split", color: "#ca8a04", description: "把流程分成多条路径", category: "logic" },
  { type: "merge", label: "合并", icon: "Merge", color: "#475569", description: "合并多个上游输入", category: "logic" },
  { type: "loop", label: "循环", icon: "Repeat", color: "#ca8a04", description: "重复执行一段流程", category: "logic" },
  { type: "retry", label: "重试", icon: "RefreshCcw", color: "#ca8a04", description: "失败后按规则重新执行", category: "logic" },
  { type: "human_review", label: "人工确认", icon: "UserCheck", color: "#64748b", description: "暂停流程，等待人工确认", category: "logic" },

  { type: "text_extract", label: "文本提取", icon: "FileText", color: "#0f766e", description: "从文件中提取文本内容", category: "data" },
  { type: "json_transform", label: "JSON 转换", icon: "Braces", color: "#0f766e", description: "整理或转换 JSON 数据", category: "data" },
  { type: "table_process", label: "表格处理", icon: "Table", color: "#0f766e", description: "处理 Excel 或 CSV 表格", category: "data" },
  { type: "chunk_split", label: "文本切分", icon: "Scissors", color: "#0f766e", description: "把长文本切成多个片段", category: "data" },
  { type: "search", label: "检索", icon: "Search", color: "#0f766e", description: "从知识库或文件中查找内容", category: "data" },

  { type: "code_generation", label: "代码生成", icon: "Code2", color: "#16a34a", description: "让 AI 生成代码", category: "tool" },
  { type: "code_execution", label: "代码执行", icon: "Terminal", color: "#15803d", description: "在受限目录中运行代码", category: "tool" },
  { type: "http_request", label: "HTTP 请求", icon: "Send", color: "#0369a1", description: "调用外部 API 接口", category: "tool" },
  { type: "database_query", label: "数据库查询", icon: "Database", color: "#0369a1", description: "查询数据库内容", category: "tool" },
  { type: "file_write", label: "文件写入", icon: "Save", color: "#0369a1", description: "把结果写入文件", category: "tool" },

  { type: "markdown_output", label: "Markdown 输出", icon: "FileText", color: "#0369a1", description: "生成 Markdown 文档", category: "output", implementedAs: "document_write" },
  { type: "json_output", label: "JSON 输出", icon: "Braces", color: "#334155", description: "输出结构化 JSON", category: "output", implementedAs: "export" },
  { type: "report_output", label: "报告输出", icon: "ClipboardList", color: "#0369a1", description: "生成完整报告", category: "output", implementedAs: "document_write" },
  { type: "ppt_output", label: "PPT 输出", icon: "Presentation", color: "#6366f1", description: "生成演示文稿结构", category: "output" },
  { type: "word_output", label: "Word 输出", icon: "FileType", color: "#2563eb", description: "生成 Word 文档内容", category: "output" },
  { type: "export", label: "导出工作流", icon: "Download", color: "#334155", description: "导出可复用 workflow.json", category: "output" },

  { type: "format_check", label: "格式检查", icon: "CheckSquare", color: "#ea580c", description: "检查格式是否符合要求", category: "check", implementedAs: "compliance_check" },
  { type: "fact_check", label: "事实检查", icon: "ShieldCheck", color: "#ea580c", description: "检查内容是否有依据", category: "check", implementedAs: "compliance_check" },
  { type: "logic_check", label: "逻辑检查", icon: "Brain", color: "#ea580c", description: "检查推理链条是否合理", category: "check", implementedAs: "compliance_check" },
  { type: "compliance_check", label: "合规检查", icon: "BadgeCheck", color: "#ea580c", description: "检查内容是否满足规则", category: "check" },
  { type: "result_validation", label: "结果校验", icon: "CircleCheck", color: "#0f766e", description: "检查运行结果是否有效", category: "check" }
];

const catalogByType = new Map(nodeCatalog.map((item) => [item.type, item]));

export const apiLikeNodeTypes = new Set([
  "llm_call",
  "api_call",
  "chat",
  "parallel_llm",
  "cross_review",
  "consensus_merge",
  "prompt_router",
  "code_generation",
  "document_write",
  "markdown_output",
  "report_output",
  "ppt_output",
  "word_output",
  "format_check",
  "fact_check",
  "logic_check",
  "compliance_check",
  "result_validation"
]);

export const apiNodeTypes = new Set(["api_call", "llm_call"]);

const defaultExecutionStrategy = {
  execution_strategy: "single_pass",
  max_api_calls: 1,
  retry_condition: "need_more_context",
  enable_self_review: false,
  reviewer_provider_id: null,
  candidate_count: 1,
  map_reduce: {
    enabled: false,
    max_chunks: 10,
    chunk_size: 6000,
    chunk_overlap: 500,
    map_prompt: "",
    reduce_prompt: ""
  }
};

const defaultPrompts: Record<string, string> = {
  chat: "你是画布中的对话智能体。请根据用户消息直接回答，并保留上下文。",
  api_call: "请基于上游完整输出完成当前 API 节点任务。要求结构清晰、结论明确，不要编造不存在的信息。输入内容：{{input}}",
  llm_call: "请基于输入内容完成当前节点任务。要求结构清晰、结论明确、不要编造不存在的信息。输入内容：{{input}}",
  skill: "请按本技能节点的 Markdown 指令处理上游完整 output_json，并输出可继续传给下游 API 的完整结果。输入内容：{{input}}",
  parallel_llm: "请独立完成以下任务，并输出你的分析、依据、不确定点和建议。输入内容：{{input}}",
  cross_review: "请比较多个上游完整输出，按来源分类一致点、冲突点、遗漏信息、逻辑错误、风险和修订任务。必须输出结构化 JSON。",
  consensus_merge: "请基于多个上游结果生成共识结论。保留有证据支持的内容，标记仍有争议的内容。",
  prompt_router: "请根据输入内容判断应该使用哪类提示词或处理路径，并给出路由理由。输入内容：{{input}}",
  code_generation: "请根据上游输入生成可运行代码。不要伪造结果，不要硬编码最终答案。",
  document_write: "请基于上游结果生成结构清晰的 Markdown 文档。不得编造没有依据的信息。",
  markdown_output: "请基于上游结果生成结构清晰的 Markdown 文档。不得编造没有依据的信息。",
  report_output: "请基于上游结果生成结构清晰、可阅读的完整报告。不得编造没有依据的信息。",
  ppt_output: "请基于上游结果生成适合制作演示文稿的页面结构、标题和要点。",
  word_output: "请基于上游结果生成适合 Word 文档的章节结构和正文内容。",
  format_check: "请检查上游结果的格式是否完整、字段是否缺失，并输出修改建议。",
  fact_check: "请检查上游结果中需要核查的事实、可能无依据的结论和风险点。",
  logic_check: "请检查上游结果的逻辑链条、矛盾点和缺失条件，并输出修改建议。",
  compliance_check: "请检查上游结果是否完整、是否存在占位内容、是否逻辑不一致，并输出修改建议。",
  result_validation: "请检查运行结果是否有效，指出缺失文件、异常输出、错误日志或需要人工复核的部分。"
};

export function nodeLabel(type: string) {
  return catalogByType.get(type)?.label || type;
}

export function nodeDescription(type: string) {
  return catalogByType.get(type)?.description || "";
}

export function nodeColor(type: string) {
  return catalogByType.get(type)?.color || "#334155";
}

export function nodeIcon(type: string) {
  return catalogByType.get(type)?.icon || "Bot";
}

export function nodeCategory(type: string) {
  return catalogByType.get(type)?.category || null;
}

export function runtimeType(type: string) {
  return catalogByType.get(type)?.implementedAs || type;
}

export function promptPreview(config: Record<string, unknown>, maxLength = 40) {
  const summary = String(config.prompt_summary || "").trim();
  const template = String(config.prompt_template || "").trim();
  const skill = String(config.markdown_content || "").trim();
  const value = summary || template || skill;
  if (!value) return "未配置提示词";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function fullPrompt(config: Record<string, unknown>) {
  return String(config.prompt_template || config.prompt_summary || config.markdown_content || "未配置提示词");
}

function withBaseConfig(type: string, config: Record<string, unknown> = {}) {
  const isSkill = type === "skill" || type === "skill_workflow";
  const isReview = type === "cross_review";
  const base: Record<string, unknown> = {
    description: config.description || nodeDescription(type),
    node_instruction: config.node_instruction || "",
    input_mapping: config.input_mapping || {},
    output_key: config.output_key || "output",
    context_config: config.context_config || defaultContextConfig(isSkill || isReview ? "hybrid" : "full_previous", isSkill || isReview)
  };
  if (apiLikeNodeTypes.has(type)) {
    base.provider_id = config.provider_id ?? null;
    base.system_prompt = config.system_prompt || "";
    base.prompt_template = config.prompt_template || defaultPrompts[type] || defaultPrompts.llm_call;
    base.prompt_summary = config.prompt_summary || "";
    base.temperature = config.temperature ?? 0.7;
    base.max_tokens = config.max_tokens ?? 2000;
    Object.assign(base, defaultExecutionStrategy, config);
  }
  return { ...base, ...config };
}

function defaultContextConfig(mode: string, includeMaterials: boolean) {
  return {
    context_mode: mode,
    include_upstream_outputs: true,
    include_materials: includeMaterials,
    selected_input_paths: [],
    required_artifacts: [],
    material_retrieval: {
      enabled: includeMaterials,
      query_template: "{{skill_name}} {{markdown_content}} {{previous_output}}",
      max_chunks: 8,
      max_chars: 20000
    }
  };
}

export function defaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case "start":
      return withBaseConfig(type, {
        use_all_project_files: true,
        file_ids: [],
        text: "",
        output_key: "materials",
        description: "工作流入口：汇总项目资料并传给下游节点"
      });
    case "text_input":
      return withBaseConfig(type, { text: "请在这里输入任务文本", output_key: "input" });
    case "file_input":
      return withBaseConfig(type, { file_id: null, output_key: "file_text" });
    case "form_input":
      return withBaseConfig(type, { fields: [], output_key: "form_data" });
    case "url_input":
      return withBaseConfig(type, { url: "", output_key: "url" });
    case "variable_input":
      return withBaseConfig(type, { variable_name: "input", default_value: "", output_key: "variable" });
    case "api_call":
    case "llm_call":
      return withBaseConfig(type, { output_key: "llm_output" });
    case "chat":
      return withBaseConfig(type, {
        provider_id: null,
        system_prompt: defaultPrompts.chat,
        prompt_template: defaultPrompts.chat,
        prompt_summary: "画布对话窗口",
        chat_placeholder: "输入消息，直接和该节点绑定的 API / 智能体对话",
        chat_history: [],
        output_key: "chat_output"
      });
    case "skill":
    case "skill_workflow":
      return withBaseConfig(type, {
        provider_id: null,
        system_prompt: "你正在执行灵改流的技能节点。请严格按照该节点的 Markdown 指令处理上游完整输出，并返回完整结果。",
        prompt_summary: "",
        temperature: 0.7,
        max_tokens: 2000,
        skill_name: "新建技能",
        markdown_content: "# 技能\n\n请阅读上游 API 的完整输出，提取关键结论、问题和下一步建议。\n\n## 输出要求\n\n- 保留来源\n- 标记不确定信息\n- 输出可传给下游 API 的内容",
        output_key: "skill_output"
      });
    case "parallel_llm":
      return withBaseConfig(type, { provider_ids: [], output_key: "parallel_results" });
    case "cross_review":
      return withBaseConfig(type, {
        reviewer_provider_ids: [],
        review_criteria: "比较一致点、冲突点、遗漏信息、逻辑错误和风险等级。",
        max_rounds: 1,
        output_schema: "default",
        output_key: "cross_review"
      });
    case "consensus_merge":
    case "merge":
      return withBaseConfig(type, { merge_strategy: "json", output_key: "merged" });
    case "prompt_router":
      return withBaseConfig(type, { temperature: 0.3, max_tokens: 1000, output_key: "routing_result" });
    case "condition":
    case "switch":
      return withBaseConfig(type, { field_path: "", operator: "exists", value: "", output_key: "condition_result" });
    case "loop":
    case "retry":
      return withBaseConfig(type, { max_rounds: 1, output_key: "control_result" });
    case "human_review":
      return withBaseConfig(type, { node_instruction: "等待人工确认后继续。", output_key: "human_review" });
    case "text_extract":
    case "json_transform":
    case "table_process":
    case "chunk_split":
    case "search":
      return withBaseConfig(type, { transform_rule: "", output_key: "data_result" });
    case "code_generation":
      return withBaseConfig(type, { language: "python", output_filename: "main.py", output_key: "code_text" });
    case "code_execution":
      return withBaseConfig(type, { command: "python main.py", timeout_seconds: 10, working_directory: ".", output_key: "execution_result" });
    case "http_request":
      return withBaseConfig(type, { method: "GET", url: "", headers: {}, body: "", output_key: "response" });
    case "database_query":
      return withBaseConfig(type, { query: "", output_key: "query_result" });
    case "file_write":
      return withBaseConfig(type, { output_filename: "output.txt", content_template: "{{previous_output}}", output_key: "file_path" });
    case "document_write":
    case "markdown_output":
    case "report_output":
      return withBaseConfig(type, { document_type: "markdown", output_filename: type === "report_output" ? "report.md" : "output.md" });
    case "ppt_output":
      return withBaseConfig(type, { output_filename: "slides.pptx", placeholder: true, output_key: "ppt_output" });
    case "word_output":
      return withBaseConfig(type, { output_filename: "document.docx", placeholder: true, output_key: "word_output" });
    case "format_check":
    case "logic_check":
    case "fact_check":
    case "compliance_check":
      return withBaseConfig(type, {
        checklist: ["是否完整", "是否存在占位内容", "是否逻辑一致"],
        pass_condition: "no_blocking_issues",
        output_key: "check_result"
      });
    case "result_validation":
      return withBaseConfig(type, { required_files: ["result.txt"], check_stdout: true, check_stderr: true, output_key: "validation_result" });
    case "json_output":
    case "export":
      return withBaseConfig(type, { export_format: "json", output_filename: "workflow_output.json" });
    default:
      return withBaseConfig(type);
  }
}

export function normalizeNodeConfig(type: string, config: Record<string, unknown> = {}) {
  return { ...defaultConfig(type), ...config };
}

export function makeReactNode(type: string, position: { x: number; y: number }, id = `${type}_${Date.now()}`): Node {
  const label = nodeLabel(type);
  return {
    id,
    type: "workflowNode",
    position,
    data: {
      label,
      icon: nodeIcon(type),
      node_type: type,
      runtime_type: runtimeType(type),
      description: nodeDescription(type),
      status: "pending" satisfies NodeRunStatus,
      config: defaultConfig(type)
    }
  };
}

export function toReactFlow(workflow: WorkflowJson): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: (workflow.nodes || []).map((node) => {
      const data = node.data || {
        label: node.name || nodeLabel(node.type),
        description: "",
        status: "pending" as NodeRunStatus,
        config: node.config || {}
      };
      const config = normalizeNodeConfig(node.type, data.config || node.config || {});
      return {
        id: node.id,
        type: "workflowNode",
        position: node.position || { x: 0, y: 0 },
        data: {
          label: data.label || node.name || nodeLabel(node.type),
          icon: data.icon || nodeIcon(node.type),
          node_type: node.type,
          runtime_type: runtimeType(node.type),
          description: data.description || String(config.description || nodeDescription(node.type)),
          status: data.status || "pending",
          config
        }
      };
    }),
    edges: (workflow.edges || []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || edge.source_handle || undefined,
      targetHandle: edge.targetHandle || edge.target_handle || undefined,
      type: "smoothstep",
      animated: false,
      label: typeof edge.condition === "string" ? edge.condition : undefined,
      data: {
        condition: typeof edge.condition === "string" ? edge.condition : null,
        transfer_mode: edge.transfer_mode || "full_output",
        selected_paths: edge.selected_paths || []
      },
      markerEnd: { type: "arrowclosed", width: 18, height: 18, color: "#64748b" },
      style: { stroke: "#64748b", strokeWidth: 1.8 }
    }))
  };
}

export function fromReactFlow(base: WorkflowJson, nodes: Node[], edges: Edge[]): WorkflowJson {
  const workflowNodes: WorkflowNode[] = nodes.map((node) => {
    const nodeType = String(node.data?.node_type || "llm_call");
    const config = normalizeNodeConfig(nodeType, (node.data?.config as Record<string, unknown>) || {});
    const label = String(node.data?.label || nodeLabel(nodeType));
    const description = String(node.data?.description || config.description || nodeDescription(nodeType));
    const icon = String(node.data?.icon || nodeIcon(nodeType));
    return {
      id: node.id,
      type: nodeType,
      name: label,
      position: node.position,
      data: {
        label,
        icon,
        node_type: nodeType,
        runtime_type: runtimeType(nodeType),
        description,
        status: (node.data?.status as NodeRunStatus) || "pending",
        config
      },
      config,
      inputs: [],
      outputs: []
    };
  });
  const workflowEdges: WorkflowEdge[] = edges.map((edge) => {
    const edgeData = (edge.data || {}) as Record<string, unknown>;
    const condition = String(edge.label || edgeData.condition || "").trim() || null;
    const transferMode = String(edgeData.transfer_mode || "full_output");
    const selectedPaths = Array.isArray(edgeData.selected_paths) ? edgeData.selected_paths : [];
    return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || null,
    targetHandle: edge.targetHandle || null,
    source_handle: edge.sourceHandle || null,
    target_handle: edge.targetHandle || null,
    condition,
    transfer_mode: transferMode,
    selected_paths: selectedPaths
    };
  });
  return { ...base, nodes: workflowNodes, edges: workflowEdges };
}
