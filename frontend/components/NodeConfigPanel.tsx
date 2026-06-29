"use client";

import type { Edge, Node } from "@xyflow/react";
import type { ApiProvider, FileAsset, WorkflowJson, WorkflowRunStep } from "@/types/workflow";
import { api } from "@/lib/api";
import { projectPath } from "@/lib/routes";
import { apiLikeNodeTypes, apiNodeTypes, nodeLabel } from "@/lib/workflow";
import { JsonView } from "@/components/JsonView";

type Props = {
  node: Node | null;
  edge?: Edge | null;
  projectId?: number;
  providers: ApiProvider[];
  files: FileAsset[];
  workflow: WorkflowJson;
  runStep?: WorkflowRunStep | null;
  onWorkflowChange: (workflow: WorkflowJson) => void;
  onChange: (nodeId: string, patch: { label?: string; description?: string; config?: Record<string, unknown> }) => void;
  onFilesChange?: () => Promise<void> | void;
  onEdgeChange?: (edgeId: string, patch: { condition?: string; transfer_mode?: string; selected_paths?: unknown[] }) => void;
};

export function NodeConfigPanel({ node, edge, projectId, providers, files, workflow, runStep, onWorkflowChange, onChange, onFilesChange, onEdgeChange }: Props) {
  if (!node && edge) {
    const edgeData = (edge.data || {}) as Record<string, unknown>;
    const condition = String(edge.label || edgeData.condition || "");
    const transferMode = String(edgeData.transfer_mode || "full_output");
    const selectedPathsText = JSON.stringify(edgeData.selected_paths || [], null, 2);
    return (
      <aside className="flex h-full flex-col overflow-auto">
        <div className="border-b border-line p-4">
          <div className="text-xs text-slate-500">连线配置</div>
          <h2 className="mt-1 text-base font-semibold">连线配置</h2>
        </div>
        <Section title="箭头传递">
          <Metric label="来源节点" value={edge.source} />
          <Metric label="目标节点" value={edge.target} />
          <Select label="传递模式（transfer_mode）" value={transferMode} onChange={(value) => onEdgeChange?.(edge.id, { transfer_mode: value })}>
            <option value="full_output">完整输出（full_output）</option>
            <option value="selected_paths">指定字段（selected_paths）</option>
            <option value="artifact_only">仅传产物（artifact_only）</option>
            <option value="condition_route">按条件路由（condition_route）</option>
          </Select>
          <TextArea label="指定字段路径（selected_paths，JSON）" rows={5} value={selectedPathsText} onChange={(value) => onEdgeChange?.(edge.id, { selected_paths: parseJsonOrText(value) as unknown[] })} />
          <div className="rounded-tool border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
            节点会完整执行结束后，才把完整 output_json 沿箭头传给下一个节点，不做逐字或流式传递。
          </div>
        </Section>
        <Section title="交叉验证路由">
          <Input label="路由条件 / 分类标签" value={condition} onChange={(value) => onEdgeChange?.(edge.id, { condition: value })} />
          <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            从交叉验证节点输出到 API 节点时，可填写 agreement、conflict、missing、logic_error、risk 或 revision_tasks。留空则传递完整上游输出。
          </div>
        </Section>
      </aside>
    );
  }

  if (!node) {
    const metadata = workflow.metadata || {};
    const variables = workflow.variables || {};
    return (
      <aside className="flex h-full flex-col overflow-auto">
        <div className="border-b border-line p-4">
          <div className="text-xs text-slate-500">工作流配置</div>
          <h2 className="mt-1 text-base font-semibold">工作流配置</h2>
        </div>
        <Section title="基础信息">
          <Input label="工作流名称" value={workflow.name || ""} onChange={(value) => onWorkflowChange({ ...workflow, name: value })} />
          <TextArea
            label="工作流描述"
            rows={4}
            value={String(metadata.description || "")}
            onChange={(value) => onWorkflowChange({ ...workflow, metadata: { ...metadata, description: value } })}
          />
          <Input label="适用场景" value={String(metadata.scenario || "")} onChange={(value) => onWorkflowChange({ ...workflow, metadata: { ...metadata, scenario: value } })} />
          <Input label="workflow.json 版本" value={workflow.version || "0.1.0"} onChange={(value) => onWorkflowChange({ ...workflow, version: value })} />
        </Section>
        <Section title="输入输出变量">
          <TextArea
            label="输入变量（JSON）"
            rows={5}
            value={JSON.stringify(variables.inputs || [], null, 2)}
            onChange={(value) => onWorkflowChange({ ...workflow, variables: { ...variables, inputs: parseJsonOrText(value) } })}
          />
          <TextArea
            label="输出变量（JSON）"
            rows={5}
            value={JSON.stringify(variables.outputs || [], null, 2)}
            onChange={(value) => onWorkflowChange({ ...workflow, variables: { ...variables, outputs: parseJsonOrText(value) } })}
          />
        </Section>
        <Section title="运行设置">
          <Select label="默认 API / 智能体" value={String(metadata.default_provider_id || "")} onChange={(value) => onWorkflowChange({ ...workflow, metadata: { ...metadata, default_provider_id: value ? Number(value) : null } })}>
            <option value="">未指定</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} ({provider.provider_type} · {provider.api_key_masked || "无密钥"})
              </option>
            ))}
          </Select>
          <Select label="运行模式" value={String(metadata.run_mode || "manual")} onChange={(value) => onWorkflowChange({ ...workflow, metadata: { ...metadata, run_mode: value } })}>
            <option value="manual">手动运行（manual）</option>
            <option value="batch">批量运行（batch）</option>
            <option value="api">接口调用（api）</option>
          </Select>
          <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs text-slate-500">
            未选中节点时，这里用于配置通用 workflow.json 的说明、变量和运行默认值。
          </div>
        </Section>
      </aside>
    );
  }

  const currentNode = node;
  const nodeType = String(currentNode.data?.node_type || "");
  const config = ((currentNode.data?.config as Record<string, unknown>) || {}) as Record<string, unknown>;
  const isStartNode = nodeType === "start";
  const isApiNode = apiNodeTypes.has(nodeType);
  const isChatNode = nodeType === "chat";
  const isSkillNode = nodeType === "skill" || nodeType === "skill_workflow";
  const hasPromptConfig = apiLikeNodeTypes.has(nodeType);
  const usesSingleProvider = hasPromptConfig && !["parallel_llm", "cross_review"].includes(nodeType);

  function updateConfig(key: string, value: unknown) {
    onChange(currentNode.id, { config: { ...config, [key]: value } });
  }

  function updateProviderArray(key: string, value: string[]) {
    updateConfig(
      key,
      value.map((item) => Number(item)).filter(Boolean)
    );
  }

  return (
    <aside className="flex h-full flex-col overflow-auto">
      <div className="border-b border-line p-4">
        <div className="text-xs text-slate-500">{nodeType}</div>
        <h2 className="mt-1 text-base font-semibold">{nodeLabel(nodeType)}</h2>
      </div>

      <Section title="基础信息">
        <Input label="节点名称" value={String(currentNode.data?.label || "")} onChange={(value) => onChange(currentNode.id, { label: value })} />
        <TextArea label="节点描述" rows={3} value={String(currentNode.data?.description || config.description || "")} onChange={(value) => onChange(currentNode.id, { description: value, config: { ...config, description: value } })} />
        {!apiLikeNodeTypes.has(nodeType) && !isSkillNode && !isStartNode && (
          <TextArea label="节点指令" rows={3} value={String(config.node_instruction || "")} onChange={(value) => updateConfig("node_instruction", value)} />
        )}
      </Section>

      <ContextConfigSection config={config} updateConfig={updateConfig} />

      {(isApiNode || isSkillNode) && (
        <ExecutionStrategySection config={config} providers={providers} updateConfig={updateConfig} />
      )}

      {isStartNode && (
        <StartMaterialsConfig projectId={projectId} files={files} config={config} updateConfig={updateConfig} onFilesChange={onFilesChange} />
      )}

      {(isApiNode || isChatNode) && (
        <Section title="API 配置">
          <ProviderSelect providers={providers} value={config.provider_id} onChange={(value) => updateConfig("provider_id", value ? Number(value) : null)} />
          <ProviderDetails provider={findProvider(providers, config.provider_id)} />
          {projectId && (
            <a className="btn w-full justify-center" href={projectPath(projectId)}>
              添加 / 管理 API / 智能体
            </a>
          )}
          <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            API 密钥保存在项目级 API / 智能体配置中，画布节点只保存 provider_id，不会把明文密钥写入 workflow.json。
          </div>
        </Section>
      )}

      {usesSingleProvider && !isApiNode && !isChatNode && (
        <Section title="模型配置">
          <ProviderSelect providers={providers} value={config.provider_id} onChange={(value) => updateConfig("provider_id", value ? Number(value) : null)} />
          <NumberInput label="temperature" value={Number(config.temperature ?? 0.7)} onChange={(value) => updateConfig("temperature", value)} />
          <NumberInput label="max_tokens" value={Number(config.max_tokens ?? 2000)} onChange={(value) => updateConfig("max_tokens", value)} />
        </Section>
      )}

      {isChatNode && (
        <Section title="对话配置">
          <TextArea label="系统提示词（system_prompt）" rows={4} value={String(config.system_prompt || "")} onChange={(value) => updateConfig("system_prompt", value)} />
          <Input label="输入框提示" value={String(config.chat_placeholder || "")} onChange={(value) => updateConfig("chat_placeholder", value)} />
          <Input label="输出字段（output_key）" value={String(config.output_key || "chat_output")} onChange={(value) => updateConfig("output_key", value)} />
          <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            对话窗口与当前节点直接绑定，聊天记录会保存到 node.data.config.chat_history，并可作为该节点输出继续通过箭头传递。
          </div>
          <button className="btn w-full justify-center" onClick={() => updateConfig("chat_history", [])}>
            清空对话记录
          </button>
        </Section>
      )}

      {isSkillNode && (
        <Section title="技能节点使用的 API / 智能体">
          <ProviderSelect providers={providers} value={config.provider_id} onChange={(value) => updateConfig("provider_id", value ? Number(value) : null)} />
          <ProviderDetails provider={findProvider(providers, config.provider_id)} />
          {projectId && (
            <a className="btn w-full justify-center" href={projectPath(projectId)}>
              添加 / 管理 API / 智能体
            </a>
          )}
          <TextArea label="系统提示词（system_prompt）" rows={3} value={String(config.system_prompt || "")} onChange={(value) => updateConfig("system_prompt", value)} />
          <NumberInput label="温度（temperature）" value={Number(config.temperature ?? 0.7)} onChange={(value) => updateConfig("temperature", value)} />
          <NumberInput label="最大输出长度（max_tokens）" value={Number(config.max_tokens ?? 2000)} onChange={(value) => updateConfig("max_tokens", value)} />
          <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            技能节点不会复用上一个 API 节点的模型。这里选择哪个 API / 智能体，这个技能节点就用哪个模型执行自己的 Markdown 提示词；不选时运行时自动使用项目里第一个启用的 API / 智能体。
          </div>
        </Section>
      )}

      {isApiNode && (
        <Section title="提示词配置">
          <TextArea label="系统提示词（system_prompt）" rows={3} value={String(config.system_prompt || "")} onChange={(value) => updateConfig("system_prompt", value)} />
          <Input label="提示词摘要（prompt_summary）" value={String(config.prompt_summary || "")} onChange={(value) => updateConfig("prompt_summary", value)} />
          <TextArea label="提示词模板（prompt_template）" rows={8} value={String(config.prompt_template || "")} onChange={(value) => updateConfig("prompt_template", value)} />
          <NumberInput label="温度（temperature）" value={Number(config.temperature ?? 0.7)} onChange={(value) => updateConfig("temperature", value)} />
          <NumberInput label="最大输出长度（max_tokens）" value={Number(config.max_tokens ?? 2000)} onChange={(value) => updateConfig("max_tokens", value)} />
          <TextArea label="输入映射（input_mapping，JSON）" rows={4} value={JSON.stringify(config.input_mapping || {}, null, 2)} onChange={(value) => updateJsonConfig("input_mapping", value, updateConfig)} />
          <Input label="输出字段（output_key）" value={String(config.output_key || "output")} onChange={(value) => updateConfig("output_key", value)} />
        </Section>
      )}

      {nodeType === "parallel_llm" && (
        <Section title="模型配置">
          <MultiProvider providers={providers} value={(config.provider_ids as number[]) || []} onChange={(value) => updateProviderArray("provider_ids", value)} />
        </Section>
      )}

      {nodeType === "cross_review" && (
        <Section title="交叉验证配置">
          <MultiProvider providers={providers} value={(config.reviewer_provider_ids as number[]) || []} onChange={(value) => updateProviderArray("reviewer_provider_ids", value)} />
          <NumberInput label="最大轮数（max_rounds）" value={Number(config.max_rounds ?? 1)} onChange={(value) => updateConfig("max_rounds", value)} />
          <TextArea label="评审标准（review_criteria）" rows={4} value={String(config.review_criteria || "")} onChange={(value) => updateConfig("review_criteria", value)} />
          <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            支持多个输入。输出会包含 agreement、conflict、missing、logic_error、risk、revision_tasks，可在下游连线上填写同名 condition 发送给不同 API。
          </div>
        </Section>
      )}

      {hasPromptConfig && !isApiNode && !isChatNode && (
        <Section title="提示词配置">
          <TextArea label="系统提示词（system_prompt）" rows={3} value={String(config.system_prompt || "")} onChange={(value) => updateConfig("system_prompt", value)} />
          <Input label="提示词摘要（prompt_summary）" value={String(config.prompt_summary || "")} onChange={(value) => updateConfig("prompt_summary", value)} />
          <TextArea label="提示词模板（prompt_template）" rows={8} value={String(config.prompt_template || "")} onChange={(value) => updateConfig("prompt_template", value)} />
          <TextArea label="输入映射（input_mapping，JSON）" rows={4} value={JSON.stringify(config.input_mapping || {}, null, 2)} onChange={(value) => updateJsonConfig("input_mapping", value, updateConfig)} />
          {nodeType !== "cross_review" && <Input label="输出字段（output_key）" value={String(config.output_key || "output")} onChange={(value) => updateConfig("output_key", value)} />}
        </Section>
      )}

      {isSkillNode && (
        <Section title="技能 / 节点工作流">
          <Input label="技能名称（skill_name）" value={String(config.skill_name || "")} onChange={(value) => updateConfig("skill_name", value)} />
          <Input label="提示词摘要（prompt_summary）" value={String(config.prompt_summary || "")} onChange={(value) => updateConfig("prompt_summary", value)} />
          <TextArea label="技能专用提示词（Markdown）" rows={12} value={String(config.markdown_content || "")} onChange={(value) => updateConfig("markdown_content", value)} />
          <TextArea label="输入映射（input_mapping，JSON）" rows={4} value={JSON.stringify(config.input_mapping || {}, null, 2)} onChange={(value) => updateJsonConfig("input_mapping", value, updateConfig)} />
          <Input label="输出字段（output_key）" value={String(config.output_key || "skill_output")} onChange={(value) => updateConfig("output_key", value)} />
          <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            技能节点会等上游节点完整执行结束，读取完整 output_json，再调用本节点选择的 API 按 Markdown 提示词处理，最后把完整结果通过箭头传给下游 API 或交叉验证节点。
          </div>
        </Section>
      )}

      <Section title="节点字段">
        {nodeType === "text_input" && (
          <>
            <TextArea label="文本" rows={5} value={String(config.text || "")} onChange={(value) => updateConfig("text", value)} />
            <Input label="输出字段（output_key）" value={String(config.output_key || "input")} onChange={(value) => updateConfig("output_key", value)} />
          </>
        )}
        {nodeType === "file_input" && (
          <>
            <Select label="项目文件" value={String(config.file_id || "")} onChange={(value) => updateConfig("file_id", value ? Number(value) : null)}>
              <option value="">选择文件</option>
              {files.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.original_name}
                </option>
              ))}
            </Select>
            <Input label="输出字段（output_key）" value={String(config.output_key || "file_text")} onChange={(value) => updateConfig("output_key", value)} />
          </>
        )}
        {nodeType === "cross_review" && <Input label="输出字段（output_key）" value={String(config.output_key || "cross_review")} onChange={(value) => updateConfig("output_key", value)} />}
        {(nodeType === "merge" || nodeType === "consensus_merge") && (
          <>
            <Select label="合并策略" value={String(config.merge_strategy || "json")} onChange={(value) => updateConfig("merge_strategy", value)}>
              <option value="json">json</option>
              <option value="text">text</option>
            </Select>
            <Input label="输出字段（output_key）" value={String(config.output_key || "merged")} onChange={(value) => updateConfig("output_key", value)} />
          </>
        )}
        {(nodeType === "condition" || nodeType === "switch") && (
          <>
            <Input label="字段路径" value={String(config.field_path || "")} onChange={(value) => updateConfig("field_path", value)} />
            <Select label="操作符" value={String(config.operator || "exists")} onChange={(value) => updateConfig("operator", value)}>
              <option value="exists">exists</option>
              <option value="equals">equals</option>
              <option value="contains">contains</option>
            </Select>
            <Input label="比较值" value={String(config.value || "")} onChange={(value) => updateConfig("value", value)} />
          </>
        )}
        {nodeType === "code_generation" && (
          <>
            <Input label="语言" value={String(config.language || "python")} onChange={(value) => updateConfig("language", value)} />
            <Input label="输出文件名" value={String(config.output_filename || "main.py")} onChange={(value) => updateConfig("output_filename", value)} />
          </>
        )}
        {nodeType === "code_execution" && (
          <>
            <Input label="命令" value={String(config.command || "python main.py")} onChange={(value) => updateConfig("command", value)} />
            <NumberInput label="超时秒数" value={Number(config.timeout_seconds ?? 10)} onChange={(value) => updateConfig("timeout_seconds", value)} />
            <Input label="工作目录" value={String(config.working_directory || ".")} onChange={(value) => updateConfig("working_directory", value)} />
          </>
        )}
        {nodeType === "result_validation" && (
          <>
            <TextArea
              label="必需文件（一行一个）"
              rows={4}
              value={((config.required_files as string[]) || []).join("\n")}
              onChange={(value) => updateConfig("required_files", value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))}
            />
            <Check label="检查标准输出（stdout）" checked={Boolean(config.check_stdout)} onChange={(value) => updateConfig("check_stdout", value)} />
            <Check label="检查错误输出（stderr）" checked={Boolean(config.check_stderr)} onChange={(value) => updateConfig("check_stderr", value)} />
          </>
        )}
        {["document_write", "markdown_output", "report_output", "ppt_output", "word_output"].includes(nodeType) && (
          <>
            <Input label="文档类型" value={String(config.document_type || "markdown")} onChange={(value) => updateConfig("document_type", value)} />
            <Input label="输出文件名" value={String(config.output_filename || "report.md")} onChange={(value) => updateConfig("output_filename", value)} />
          </>
        )}
        {["compliance_check", "format_check", "fact_check", "logic_check"].includes(nodeType) && (
          <>
            <TextArea
              label="检查清单（一行一个）"
              rows={5}
              value={((config.checklist as string[]) || []).join("\n")}
              onChange={(value) => updateConfig("checklist", value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))}
            />
            <Input label="通过条件" value={String(config.pass_condition || "no_blocking_issues")} onChange={(value) => updateConfig("pass_condition", value)} />
          </>
        )}
        {nodeType === "http_request" && (
          <>
            <Select label="方法" value={String(config.method || "GET")} onChange={(value) => updateConfig("method", value)}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </Select>
            <Input label="请求地址（URL）" value={String(config.url || "")} onChange={(value) => updateConfig("url", value)} />
            <TextArea label="请求头（headers，JSON）" rows={4} value={JSON.stringify(config.headers || {}, null, 2)} onChange={(value) => updateJsonConfig("headers", value, updateConfig)} />
            <TextArea label="请求体（body）" rows={4} value={String(config.body || "")} onChange={(value) => updateConfig("body", value)} />
          </>
        )}
        {nodeType === "database_query" && <TextArea label="查询语句" rows={5} value={String(config.query || "")} onChange={(value) => updateConfig("query", value)} />}
        {nodeType === "file_write" && (
          <>
            <Input label="输出文件名" value={String(config.output_filename || "output.txt")} onChange={(value) => updateConfig("output_filename", value)} />
            <TextArea label="内容模板" rows={5} value={String(config.content_template || "{{previous_output}}")} onChange={(value) => updateConfig("content_template", value)} />
          </>
        )}
        {nodeType === "export" || nodeType === "json_output" ? (
          <>
            <Select label="导出格式" value={String(config.export_format || "json")} onChange={(value) => updateConfig("export_format", value)}>
              <option value="json">json</option>
              <option value="markdown">markdown</option>
            </Select>
            <Input label="输出文件名" value={String(config.output_filename || "workflow_output.json")} onChange={(value) => updateConfig("output_filename", value)} />
          </>
        ) : null}
      </Section>

      <Section title="上次运行结果">
        {runStep ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label="状态" value={runStep.status} />
              <Metric label="耗时" value={`${runStep.duration_ms} ms`} />
            </div>
            {runStep.error_message && <div className="rounded-tool border border-red-200 bg-red-50 p-2 text-xs text-red-700">{runStep.error_message}</div>}
            <div>
              <h4 className="mb-1 text-xs font-semibold">执行策略 / API 调用</h4>
              <JsonView value={runTrace(runStep.output_json)} />
            </div>
            <div>
              <h4 className="mb-1 text-xs font-semibold">input_json</h4>
              <JsonView value={runStep.input_json} />
            </div>
            <div>
              <h4 className="mb-1 text-xs font-semibold">output_json</h4>
              <JsonView value={runStep.output_json} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">运行后可在这里查看该节点的输入、输出、错误和耗时。</p>
        )}
      </Section>
    </aside>
  );
}

function runTrace(output: Record<string, unknown> | null) {
  return {
    live: output?.live || false,
    message: output?.message || "",
    current_attempt: output?.current_attempt || {},
    updated_at: output?.updated_at || "",
    execution_strategy: output?.execution_strategy || "single_pass",
    actual_api_call_count: output?.actual_api_call_count || 0,
    api_call_attempt_count: output?.api_call_attempt_count || 0,
    provider_attempt_count: providerAttemptCount(output?.api_calls),
    max_api_calls: output?.max_api_calls || 1,
    retry_info: output?.retry_info || {},
    api_calls: output?.api_calls || []
  };
}

function providerAttemptCount(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const attempts = record.attempts;
    return total + (Array.isArray(attempts) && attempts.length ? attempts.length : record.skipped ? 0 : 1);
  }, 0);
}

function updateJsonConfig(key: string, value: string, updateConfig: (key: string, value: unknown) => void) {
  try {
    updateConfig(key, JSON.parse(value || "{}"));
  } catch {
    updateConfig(key, value);
  }
}

function parseJsonOrText(value: string) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return value;
  }
}

function findProvider(providers: ApiProvider[], value: unknown) {
  const id = Number(value || 0);
  return providers.find((provider) => provider.id === id) || null;
}

function ContextConfigSection({ config, updateConfig }: { config: Record<string, unknown>; updateConfig: (key: string, value: unknown) => void }) {
  const context = normalizeContextConfig(config.context_config);
  const retrieval = context.material_retrieval;
  function patchContext(patch: Record<string, unknown>) {
    updateConfig("context_config", { ...context, ...patch });
  }
  function patchRetrieval(patch: Record<string, unknown>) {
    patchContext({ material_retrieval: { ...retrieval, ...patch } });
  }
  return (
    <Section title="上下文配置">
      <Select label="上下文模式（context_mode）" value={String(context.context_mode)} onChange={(value) => patchContext({ context_mode: value })}>
        <option value="previous_only">仅上一节点（previous_only）</option>
        <option value="full_previous">全部上游输出（full_previous）</option>
        <option value="selected_paths">指定字段（selected_paths）</option>
        <option value="material_retrieval">资料检索（material_retrieval）</option>
        <option value="hybrid">混合模式（hybrid）</option>
      </Select>
      <Check label="包含项目资料（include_materials）" checked={Boolean(context.include_materials)} onChange={(value) => patchContext({ include_materials: value, material_retrieval: { ...retrieval, enabled: value || retrieval.enabled } })} />
      <NumberInput label="最多检索片段数（max_chunks）" value={Number(retrieval.max_chunks || 8)} onChange={(value) => patchRetrieval({ max_chunks: value })} />
      <NumberInput label="最多上下文字数（max_chars）" value={Number(retrieval.max_chars || 20000)} onChange={(value) => patchRetrieval({ max_chars: value })} />
      <TextArea label="指定输入路径（selected_input_paths，JSON）" rows={4} value={JSON.stringify(context.selected_input_paths || [], null, 2)} onChange={(value) => patchContext({ selected_input_paths: parseJsonOrText(value) })} />
      <TextArea label="必需产物（required_artifacts，JSON）" rows={3} value={JSON.stringify(context.required_artifacts || [], null, 2)} onChange={(value) => patchContext({ required_artifacts: parseJsonOrText(value) })} />
      <TextArea label="资料检索查询模板（retrieval_query_template）" rows={4} value={String(retrieval.query_template || "")} onChange={(value) => patchRetrieval({ query_template: value, enabled: true })} />
    </Section>
  );
}

function ExecutionStrategySection({
  config,
  providers,
  updateConfig
}: {
  config: Record<string, unknown>;
  providers: ApiProvider[];
  updateConfig: (key: string, value: unknown) => void;
}) {
  const strategy = String(config.execution_strategy || "single_pass");
  const mapReduce = normalizeMapReduceConfig(config.map_reduce);
  function patchMapReduce(patch: Record<string, unknown>) {
    updateConfig("map_reduce", { ...mapReduce, ...patch });
  }
  return (
    <Section title="执行策略">
      <Select label="执行策略（execution_strategy）" value={strategy} onChange={(value) => updateConfig("execution_strategy", value)}>
        <option value="single_pass">单次执行（single_pass）</option>
        <option value="retrieve_then_retry">资料不足时重试（retrieve_then_retry）</option>
        <option value="draft_review_revise">初稿-审查-修订（draft_review_revise）</option>
        <option value="multi_candidate_review">多候选评审（multi_candidate_review）</option>
        <option value="map_reduce">长资料分块汇总（map_reduce）</option>
      </Select>
      <NumberInput label="最大 API 调用次数（max_api_calls）" value={Number(config.max_api_calls ?? defaultMaxCalls(strategy))} onChange={(value) => updateConfig("max_api_calls", value)} />
      <Input label="重试条件（retry_condition）" value={String(config.retry_condition || "need_more_context")} onChange={(value) => updateConfig("retry_condition", value)} />
      <Check label="启用自检（enable_self_review）" checked={Boolean(config.enable_self_review)} onChange={(value) => updateConfig("enable_self_review", value)} />
      <Select label="评审智能体（reviewer_provider_id）" value={String(config.reviewer_provider_id || "")} onChange={(value) => updateConfig("reviewer_provider_id", value ? Number(value) : null)}>
        <option value="">默认使用本节点智能体</option>
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.name} ({provider.provider_type} · {provider.api_key_masked || "无密钥"})
          </option>
        ))}
      </Select>
      <NumberInput label="候选数量（candidate_count）" value={Number(config.candidate_count ?? defaultCandidateCount(strategy))} onChange={(value) => updateConfig("candidate_count", value)} />
      <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-500">
        单次执行保持旧逻辑；其他策略会按 max_api_calls 限制调用次数，并在运行详情的 output_json 中记录 api_calls。
      </div>
      {strategy === "map_reduce" && (
        <div className="space-y-3 rounded-tool border border-line p-3">
          <Check label="启用 map_reduce" checked={Boolean(mapReduce.enabled)} onChange={(value) => patchMapReduce({ enabled: value })} />
          <NumberInput label="最大分块数（max_chunks）" value={Number(mapReduce.max_chunks)} onChange={(value) => patchMapReduce({ max_chunks: value })} />
          <NumberInput label="分块大小（chunk_size）" value={Number(mapReduce.chunk_size)} onChange={(value) => patchMapReduce({ chunk_size: value })} />
          <NumberInput label="重叠字符数（chunk_overlap）" value={Number(mapReduce.chunk_overlap)} onChange={(value) => patchMapReduce({ chunk_overlap: value })} />
          <TextArea label="Map 提示词（map_prompt）" rows={4} value={String(mapReduce.map_prompt || "")} onChange={(value) => patchMapReduce({ map_prompt: value })} />
          <TextArea label="Reduce 提示词（reduce_prompt）" rows={4} value={String(mapReduce.reduce_prompt || "")} onChange={(value) => patchMapReduce({ reduce_prompt: value })} />
        </div>
      )}
    </Section>
  );
}

function defaultMaxCalls(strategy: string) {
  if (strategy === "retrieve_then_retry") return 2;
  if (strategy === "draft_review_revise") return 3;
  if (strategy === "multi_candidate_review") return 5;
  if (strategy === "map_reduce") return 12;
  return 1;
}

function defaultCandidateCount(strategy: string) {
  return strategy === "multi_candidate_review" ? 3 : 1;
}

function normalizeMapReduceConfig(value: unknown) {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    enabled: record.enabled ?? false,
    max_chunks: Number(record.max_chunks || 10),
    chunk_size: Number(record.chunk_size || 6000),
    chunk_overlap: Number(record.chunk_overlap || 500),
    map_prompt: String(record.map_prompt || ""),
    reduce_prompt: String(record.reduce_prompt || "")
  };
}

function normalizeContextConfig(value: unknown) {
  const context = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const retrieval = (context.material_retrieval && typeof context.material_retrieval === "object" ? context.material_retrieval : {}) as Record<string, unknown>;
  return {
    context_mode: context.context_mode || "full_previous",
    include_upstream_outputs: context.include_upstream_outputs ?? true,
    include_materials: context.include_materials ?? false,
    selected_input_paths: Array.isArray(context.selected_input_paths) ? context.selected_input_paths : [],
    required_artifacts: Array.isArray(context.required_artifacts) ? context.required_artifacts : [],
    material_retrieval: {
      enabled: retrieval.enabled ?? false,
      query_template: retrieval.query_template || "{{skill_name}} {{markdown_content}} {{previous_output}}",
      max_chunks: Number(retrieval.max_chunks || 8),
      max_chars: Number(retrieval.max_chars || 20000)
    }
  };
}

function StartMaterialsConfig({
  projectId,
  files,
  config,
  updateConfig,
  onFilesChange
}: {
  projectId?: number;
  files: FileAsset[];
  config: Record<string, unknown>;
  updateConfig: (key: string, value: unknown) => void;
  onFilesChange?: () => Promise<void> | void;
}) {
  const selectedIds = Array.isArray(config.file_ids) ? config.file_ids.map((item) => Number(item)).filter(Boolean) : [];
  const useAll = Boolean(config.use_all_project_files ?? true);

  async function uploadFiles(fileList: FileList | null) {
    if (!projectId || !fileList?.length) return;
    const uploadedIds: number[] = [];
    for (const file of Array.from(fileList)) {
      const uploaded = await api.uploadFile(projectId, file);
      uploadedIds.push(uploaded.id);
    }
    await onFilesChange?.();
    if (!useAll) {
      updateConfig("file_ids", Array.from(new Set([...selectedIds, ...uploadedIds])));
    }
  }

  function toggleFile(fileId: number, checked: boolean) {
    const next = checked ? Array.from(new Set([...selectedIds, fileId])) : selectedIds.filter((id) => id !== fileId);
    updateConfig("file_ids", next);
  }

  return (
    <Section title="开始 / 资料入口">
      <div
        className="rounded-tool border border-dashed border-blue-300 bg-blue-50 p-4 text-center text-sm text-blue-800"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          uploadFiles(event.dataTransfer.files);
        }}
      >
        <div className="font-semibold">拖拽资料到这里上传</div>
        <p className="mt-1 text-xs leading-5">支持 txt / md / pdf / docx / xlsx。暂时会把资料统一推送给开始节点，再沿箭头传给后续节点。</p>
        <label className="btn mt-3 cursor-pointer bg-white">
          选择文件上传
          <input type="file" multiple className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
        </label>
      </div>

      <Check label="使用项目中的全部资料" checked={useAll} onChange={(value) => updateConfig("use_all_project_files", value)} />

      {!useAll && (
        <div className="rounded-tool border border-line p-3">
          <div className="mb-2 text-xs font-semibold text-slate-600">选择要推送给开始节点的资料</div>
          <div className="grid max-h-48 gap-2 overflow-auto">
            {files.map((file) => (
              <label key={file.id} className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={selectedIds.includes(file.id)} onChange={(event) => toggleFile(file.id, event.target.checked)} />
                <span>
                  <span className="font-semibold text-slate-700">{file.original_name}</span>
                  <span className="ml-1 text-slate-400">#{file.id}</span>
                </span>
              </label>
            ))}
            {!files.length && <p className="text-xs text-slate-500">暂无项目资料，可以先拖拽上传。</p>}
          </div>
        </div>
      )}

      <TextArea label="手动补充文本" rows={5} value={String(config.text || "")} onChange={(value) => updateConfig("text", value)} />
      <Input label="输出字段（output_key）" value={String(config.output_key || "materials")} onChange={(value) => updateConfig("output_key", value)} />
      <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-500">
        运行时输出包含 files、file_count、manual_text、combined_text。下游 API 可通过 {"{{input}}"} 或 {"{{previous_output}}"} 读取完整资料。
      </div>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-tool border border-line bg-slate-50 p-2">
      <div className="text-slate-400">{label}</div>
      <div className="font-semibold text-slate-700">{value}</div>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const displayValue = Number.isFinite(value) ? String(value) : "";
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="number"
        value={displayValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue === "" ? 0 : Number(nextValue));
        }}
      />
    </div>
  );
}

function TextArea({ label, value, onChange, rows = 6 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea className="input resize-y" rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  );
}

function ProviderSelect({ providers, value, onChange }: { providers: ApiProvider[]; value: unknown; onChange: (value: string) => void }) {
  return (
    <Select label="选择已配置 API / 智能体" value={String(value || "")} onChange={onChange}>
      <option value="">自动选择可用智能体</option>
      {providers.map((provider) => (
        <option key={provider.id} value={provider.id}>
          {provider.name} ({provider.provider_type} · {provider.api_key_masked || "无密钥"})
        </option>
      ))}
    </Select>
  );
}

function ProviderDetails({ provider }: { provider: ApiProvider | null }) {
  if (!provider) {
    return (
      <div className="rounded-tool border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
        当前节点未指定智能体，运行时会自动选择项目中第一个启用的 API / 智能体。
      </div>
    );
  }
  return (
    <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-600">
      <div className="font-semibold text-slate-800">{provider.name}</div>
      <div className="mt-1">{provider.description || "未填写智能体描述"}</div>
      <div className="mt-2 text-slate-400">
        {provider.provider_type} · {provider.model_name || "未指定模型"} · 密钥 {provider.api_key_masked || "无"}
      </div>
    </div>
  );
}

function MultiProvider({ providers, value, onChange }: { providers: ApiProvider[]; value: number[]; onChange: (value: string[]) => void }) {
  return (
    <div className="field">
      <label>选择多个 API / 智能体</label>
      <select className="input min-h-28" multiple value={value.map(String)} onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}>
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.name} ({provider.provider_type} · {provider.api_key_masked || "无密钥"})
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
