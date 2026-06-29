import type { WorkflowJson, WorkflowNode } from "@/types/workflow";
import { defaultConfig, nodeDescription, nodeIcon, runtimeType } from "@/lib/workflow";

export type WorkflowTemplate = {
  id: string;
  name: string;
  scenario: string;
  nodeCount: number;
  requiresApi: boolean;
  badge?: string;
  build: (providerIds?: number[]) => WorkflowJson;
};

function node(id: string, type: string, name: string, x: number, y: number, config: Record<string, unknown> = {}): WorkflowNode {
  const merged = { ...defaultConfig(type), ...config };
  return {
    id,
    type,
    name,
    position: { x, y },
    data: {
      label: name,
      icon: nodeIcon(type),
      node_type: type,
      runtime_type: runtimeType(type),
      description: String(merged.description || nodeDescription(type)),
      status: "pending",
      config: merged
    },
    config: merged,
    inputs: [],
    outputs: []
  };
}

function edge(source: string, target: string, condition: string | null = null) {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    sourceHandle: "source",
    targetHandle: "target",
    source_handle: "source",
    target_handle: "target",
    condition
  };
}

function workflow(id: string, name: string, nodes: WorkflowNode[], edges: ReturnType<typeof edge>[], templateName: string): WorkflowJson {
  return {
    id,
    name,
    version: "0.1.0",
    nodes,
    edges,
    variables: {
      inputs: [],
      outputs: []
    },
    metadata: {
      template_name: templateName,
      product_position: "generic_ai_workflow_builder"
    }
  };
}

function contextConfig(mode: string, includeMaterials: boolean, maxChunks: number, requiredArtifacts: string[] = []) {
  return {
    context_mode: mode,
    include_upstream_outputs: true,
    include_materials: includeMaterials,
    selected_input_paths: [],
    required_artifacts: requiredArtifacts,
    material_retrieval: {
      enabled: includeMaterials,
      query_template: "{{skill_name}} {{markdown_content}} {{previous_output}}",
      max_chunks: maxChunks,
      max_chars: 20000
    }
  };
}

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: "blank",
    name: "空白工作流",
    scenario: "从开始到结束，自由搭建任意 AI 流程。",
    nodeCount: 2,
    requiresApi: false,
    build: () => {
      const nodes = [node("start", "start", "开始", 80, 140), node("end", "end", "结束", 380, 140)];
      return workflow("blank-template", "空白工作流", nodes, [edge("start", "end")], "空白工作流");
    }
  },
  {
    id: "generic_multi_review",
    name: "API + 技能 + 交叉验证工作流",
    scenario: "演示 API 完整输出后进入 Markdown 技能节点，再由交叉验证分类路由给下游 API 修订。",
    nodeCount: 7,
    requiresApi: true,
    badge: "推荐",
    build: (providerIds = []) => {
      const main = providerIds[0] || null;
      const backup = providerIds[1] || main;
      const nodes = [
        node("text_input", "text_input", "输入材料", 80, 180, { text: "请输入要处理的问题或材料", output_key: "input" }),
        node("api_primary", "api_call", "API 主方案", 360, 90, {
          provider_id: main,
          prompt_summary: "生成第一版方案",
          prompt_template: "请基于输入材料生成第一版方案，输出结论、依据和不确定点。\n{{previous_output}}",
          output_key: "primary_output"
        }),
        node("api_second", "api_call", "API 备选方案", 360, 270, {
          provider_id: backup,
          prompt_summary: "生成第二版方案",
          prompt_template: "请从不同角度生成第二版方案，输出结论、依据和不确定点。\n{{previous_output}}",
          output_key: "secondary_output"
        }),
        node("skill_brief", "skill", "技能整理", 670, 180, {
          provider_id: main,
          skill_name: "结果整理技能",
          markdown_content: "# 结果整理技能\n\n请阅读多个 API 的完整输出，按来源保留结论、依据、不确定点和可复核问题。\n\n## 输出要求\n\n- 不合并冲突观点\n- 标记每个观点来源\n- 给交叉验证节点提供清晰输入",
          output_key: "skill_output"
        }),
        node("cross_review", "cross_review", "交叉验证", 980, 180, {
          reviewer_provider_ids: providerIds,
          review_criteria: "按来源分类一致点、冲突点、遗漏信息、逻辑错误、风险和需要重写的任务。",
          output_key: "cross_review"
        }),
        node("api_rewrite_conflict", "api_call", "API 修订冲突", 1290, 90, {
          provider_id: main,
          prompt_summary: "根据冲突点重新输出",
          prompt_template: "请只基于交叉验证路由传入的 conflict 内容进行修订，给出修订后输出。\n{{previous_output}}",
          output_key: "conflict_revision"
        }),
        node("api_rewrite_missing", "api_call", "API 补全遗漏", 1290, 270, {
          provider_id: backup,
          prompt_summary: "根据遗漏点补全输出",
          prompt_template: "请只基于交叉验证路由传入的 missing 内容补全结果。\n{{previous_output}}",
          output_key: "missing_revision"
        })
      ];
      const edges = [
        edge("text_input", "api_primary"),
        edge("text_input", "api_second"),
        edge("api_primary", "skill_brief"),
        edge("api_second", "skill_brief"),
        edge("skill_brief", "cross_review"),
        edge("cross_review", "api_rewrite_conflict", "conflict"),
        edge("cross_review", "api_rewrite_missing", "missing")
      ];
      return workflow("api-skill-cross-review-template", "API + 技能 + 交叉验证工作流", nodes, edges, "API + 技能 + 交叉验证工作流");
    }
  },
  {
    id: "math_modeling_cross_review",
    name: "数学建模多模型交叉验证工作流",
    scenario: "作为模板库中的专业模板，用于赛题分析、建模方案、代码与论文输出。",
    nodeCount: 11,
    requiresApi: true,
    build: (providerIds = []) => {
      const main = providerIds[0] || null;
      const nodes = [
        node("file_input_problem", "file_input", "赛题文件", 60, 100, { file_id: null, output_key: "problem_text" }),
        node("analyze_problem", "llm_call", "分析赛题", 340, 100, {
          provider_id: main,
          prompt_template: "分析赛题，提取背景、问题、变量、约束、目标函数和数据输入。\n{{previous_output}}",
          prompt_summary: "提取赛题要素",
          output_key: "analysis"
        }),
        node("model_solution", "llm_call", "建模方案", 620, 100, {
          provider_id: main,
          prompt_template: "基于赛题分析给出模型选择、变量定义、目标函数、约束、求解流程和代码路线。\n{{previous_output}}",
          prompt_summary: "生成建模求解路线",
          output_key: "solution"
        }),
        node("parallel_branches", "parallel_llm", "多模型调用", 900, 100, { provider_ids: providerIds, prompt_summary: "多模型独立审视方案" }),
        node("cross_review", "cross_review", "交叉验证", 1180, 100, { reviewer_provider_ids: providerIds, review_criteria: "检查遗漏、逻辑错误、约束冲突、路线可执行性。" }),
        node("code_generation", "code_generation", "代码生成", 1460, 100, { provider_id: main, output_filename: "main.py" }),
        node("code_execution", "code_execution", "代码执行", 1740, 100),
        node("result_validation", "result_validation", "结果校验", 2020, 100),
        node("document_report", "markdown_output", "论文撰写", 2300, 100, { provider_id: main, output_filename: "math_modeling_report.md" }),
        node("compliance_check", "compliance_check", "合规检查", 2580, 100),
        node("export_result", "export", "导出", 2860, 100)
      ];
      return workflow("math-modeling-template", "数学建模多模型交叉验证工作流", nodes, nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id)), "数学建模多模型交叉验证工作流");
    }
  },
  {
    id: "paper_writing",
    name: "论文写作工作流",
    scenario: "从资料提取、初稿生成、交叉审阅到格式检查。",
    nodeCount: 7,
    requiresApi: true,
    build: (providerIds = []) => {
      const main = providerIds[0] || null;
      const nodes = [
        node("file_input", "file_input", "文件输入", 80, 140),
        node("extract", "text_extract", "文本提取", 360, 140),
        node("draft", "llm_call", "初稿生成", 640, 140, { provider_id: main, prompt_summary: "生成论文初稿" }),
        node("review", "cross_review", "交叉验证", 920, 140, { reviewer_provider_ids: providerIds }),
        node("document", "markdown_output", "文档输出", 1200, 140, { provider_id: main }),
        node("format", "format_check", "格式检查", 1480, 140, { provider_id: main }),
        node("export", "export", "导出", 1760, 140)
      ];
      return workflow("paper-writing-template", "论文写作工作流", nodes, nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id)), "论文写作工作流");
    }
  },
  {
    id: "code_review",
    name: "代码审查工作流",
    scenario: "上传代码文件，进行 AI 审查、逻辑检查和报告输出。",
    nodeCount: 4,
    requiresApi: true,
    build: (providerIds = []) => {
      const main = providerIds[0] || null;
      const nodes = [
        node("file_input", "file_input", "文件输入", 80, 140),
        node("code_review", "llm_call", "代码审查", 360, 140, { provider_id: main, prompt_summary: "审查代码质量与风险" }),
        node("logic_check", "logic_check", "逻辑检查", 640, 140, { provider_id: main }),
        node("report", "report_output", "报告输出", 920, 140, { provider_id: main })
      ];
      return workflow("code-review-template", "代码审查工作流", nodes, nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id)), "代码审查工作流");
    }
  },
  {
    id: "ppt_generation",
    name: "PPT 生成工作流",
    scenario: "从开始节点汇总资料、需求解析、资料分析、大纲、页面文案、图表规划、布局设计到质量检查。",
    nodeCount: 10,
    requiresApi: true,
    build: (providerIds = []) => {
      const main = providerIds[0] || null;
      const nodes = [
        node("start", "start", "开始 / 资料入口", 80, 160, {
          text: "在这里填写 PPT 任务要求，也可以拖拽或选择项目文件。",
          use_all_project_files: true,
          output_key: "materials"
        }),
        node("requirement", "skill", "需求解析", 360, 160, {
          provider_id: main,
          skill_name: "需求解析",
          markdown_content: "# 需求解析\n\n请提取 PPT 的主题、受众、页数、风格、必须覆盖的信息、输出格式和约束条件。",
          output_key: "requirement",
          execution_strategy: "single_pass",
          max_api_calls: 1,
          context_config: contextConfig("full_previous", true, 6)
        }),
        node("material_summary", "skill", "资料分析", 640, 160, {
          provider_id: main,
          skill_name: "资料分析",
          markdown_content: "# 资料分析\n\n请从原始资料中提取关键事实、数据、案例、可引用内容和需要谨慎表述的不确定信息。",
          output_key: "material_summary",
          execution_strategy: "map_reduce",
          max_api_calls: 12,
          map_reduce: {
            enabled: true,
            max_chunks: 10,
            chunk_size: 6000,
            chunk_overlap: 500,
            map_prompt: "请从该资料片段中提取适合制作 PPT 的关键信息、数据、案例和来源。",
            reduce_prompt: "请合并所有片段提取结果，去重、归类，并输出结构化 JSON。"
          },
          context_config: contextConfig("material_retrieval", true, 20)
        }),
        node("outline", "api_call", "大纲生成", 920, 160, {
          provider_id: main,
          prompt_summary: "生成 PPT 大纲",
          prompt_template: "请基于需求解析和资料分析生成 PPT 大纲，包含每页标题、核心观点和证据来源。\n{{context_package}}",
          output_key: "outline",
          execution_strategy: "draft_review_revise",
          max_api_calls: 3,
          context_config: contextConfig("hybrid", true, 10, ["requirement", "material_summary"])
        }),
        node("slides_content", "api_call", "单页内容生成", 1200, 160, {
          provider_id: main,
          prompt_summary: "生成每页内容",
          prompt_template: "请根据大纲生成每页 PPT 的正文、讲稿要点、图表建议和来源备注。\n{{context_package}}",
          output_key: "slides_content",
          execution_strategy: "retrieve_then_retry",
          max_api_calls: 2,
          context_config: contextConfig("hybrid", true, 8, ["outline"])
        }),
        node("visual_plan", "skill", "图表规划", 1480, 160, {
          provider_id: main,
          skill_name: "图表规划",
          markdown_content: "# 图表规划\n\n请为每页内容选择合适的图表、表格、流程图或视觉元素，并说明数据来源和生成方式。",
          output_key: "visual_plan",
          execution_strategy: "single_pass",
          max_api_calls: 1,
          context_config: contextConfig("hybrid", true, 8, ["slides_content"])
        }),
        node("layout_plan", "api_call", "布局设计", 1760, 160, {
          provider_id: main,
          prompt_summary: "设计每页布局",
          prompt_template: "请只根据 slides_content 和 visual_plan 设计每页版式结构、层级、图文比例和备注。\n{{selected_artifacts}}",
          output_key: "layout_plan",
          execution_strategy: "single_pass",
          max_api_calls: 1,
          context_config: contextConfig("selected_paths", false, 0, ["slides_content", "visual_plan"])
        }),
        node("quality_check", "cross_review", "质量检查", 2040, 160, {
          reviewer_provider_ids: providerIds,
          review_criteria: "检查需求覆盖、资料依据、页面结构、视觉规划、布局一致性、 unsupported claims 和 missing information。",
          output_key: "quality_check",
          execution_strategy: "single_pass",
          max_api_calls: 1,
          context_config: contextConfig("hybrid", true, 15, ["requirement", "outline", "slides_content", "visual_plan", "layout_plan"])
        }),
        node("ppt", "ppt_output", "PPT 输出", 2320, 160, {
          output_key: "ppt_output",
          context_config: contextConfig("selected_paths", false, 0, ["slides_content", "visual_plan", "layout_plan", "quality_check"])
        }),
        node("export", "export", "导出", 2600, 160)
      ];
      return workflow("ppt-generation-template", "PPT 生成工作流", nodes, nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id)), "PPT 生成工作流");
    }
  },
  {
    id: "novel_writing",
    name: "小说创作工作流",
    scenario: "人物设定、情节生成、多轮审阅和章节输出。",
    nodeCount: 5,
    requiresApi: true,
    build: (providerIds = []) => {
      const main = providerIds[0] || null;
      const nodes = [
        node("text_input", "text_input", "故事设定", 80, 140),
        node("outline", "llm_call", "大纲生成", 360, 140, { provider_id: main, prompt_summary: "生成故事大纲" }),
        node("chapter", "llm_call", "章节生成", 640, 140, { provider_id: main, prompt_summary: "生成章节草稿" }),
        node("review", "cross_review", "交叉验证", 920, 140, { reviewer_provider_ids: providerIds }),
        node("document", "markdown_output", "Markdown 输出", 1200, 140, { provider_id: main })
      ];
      return workflow("novel-writing-template", "小说创作工作流", nodes, nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id)), "小说创作工作流");
    }
  },
  {
    id: "data_analysis",
    name: "数据分析工作流",
    scenario: "文件输入、解析、AI 分析、报告输出。",
    nodeCount: 5,
    requiresApi: true,
    build: (providerIds = []) => {
      const main = providerIds[0] || null;
      const nodes = [
        node("file_input", "file_input", "文件输入", 80, 140),
        node("parse", "json_transform", "JSON 转换", 360, 140),
        node("analysis", "llm_call", "智能分析", 640, 140, { provider_id: main }),
        node("validate", "result_validation", "结果校验", 920, 140),
        node("report", "report_output", "报告输出", 1200, 140, { provider_id: main })
      ];
      return workflow("data-analysis-template", "数据分析工作流", nodes, nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id)), "数据分析工作流");
    }
  },
  {
    id: "knowledge_qa",
    name: "知识库问答工作流",
    scenario: "文本切分、检索、AI 回答与结果输出。",
    nodeCount: 5,
    requiresApi: true,
    build: (providerIds = []) => {
      const main = providerIds[0] || null;
      const nodes = [
        node("file_input", "file_input", "文件输入", 80, 140),
        node("chunk", "chunk_split", "文本切分", 360, 140),
        node("search", "search", "检索", 640, 140),
        node("answer", "llm_call", "智能回答", 920, 140, { provider_id: main }),
        node("json", "json_output", "JSON 输出", 1200, 140)
      ];
      return workflow("knowledge-qa-template", "知识库问答工作流", nodes, nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id)), "知识库问答工作流");
    }
  },
  {
    id: "customer_service",
    name: "客服机器人工作流",
    scenario: "问题输入、意图识别、检索、回复生成。",
    nodeCount: 5,
    requiresApi: true,
    build: (providerIds = []) => {
      const main = providerIds[0] || null;
      const nodes = [
        node("text_input", "text_input", "用户消息", 80, 140),
        node("router", "prompt_router", "提示词路由", 360, 140, { provider_id: main }),
        node("search", "search", "检索", 640, 140),
        node("reply", "llm_call", "Reply LLM", 920, 140, { provider_id: main }),
        node("json", "json_output", "JSON 输出", 1200, 140)
      ];
      return workflow("customer-service-template", "客服机器人工作流", nodes, nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id)), "客服机器人工作流");
    }
  },
  {
    id: "api_automation",
    name: "API 自动化工作流",
    scenario: "变量输入、HTTP 请求、数据转换、结果输出。",
    nodeCount: 5,
    requiresApi: false,
    build: () => {
      const nodes = [
        node("variable", "variable_input", "变量输入", 80, 140),
        node("request", "http_request", "HTTP 请求", 360, 140),
        node("transform", "json_transform", "JSON 转换", 640, 140),
        node("check", "format_check", "格式检查", 920, 140),
        node("json", "json_output", "JSON 输出", 1200, 140)
      ];
      return workflow("api-automation-template", "API 自动化工作流", nodes, nodes.slice(0, -1).map((item, index) => edge(item.id, nodes[index + 1].id)), "API 自动化工作流");
    }
  }
];

export function getTemplate(templateId: string) {
  return workflowTemplates.find((item) => item.id === templateId) || workflowTemplates[0];
}

