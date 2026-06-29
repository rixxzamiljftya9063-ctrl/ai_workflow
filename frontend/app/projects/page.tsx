"use client";

import { ChangeEvent, FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, FileUp, FlaskConical, GitBranch, Plus, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { navigateApp, runPath, workflowPath } from "@/lib/routes";
import { workflowTemplates } from "@/lib/workflowTemplates";
import type { ApiProvider, FileAsset, Project, ProviderTestResult, ProviderType, Workflow, WorkflowRun } from "@/types/workflow";

const providerTypes: ProviderType[] = ["mock", "openai_compatible", "deepseek", "anthropic", "custom"];

const providerTypeLabels: Record<ProviderType, string> = {
  mock: "模拟智能体（mock）",
  openai_compatible: "OpenAI 兼容接口（openai_compatible）",
  deepseek: "DeepSeek（deepseek）",
  anthropic: "Anthropic（anthropic）",
  custom: "自定义接口（custom）"
};

export default function ProjectPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-slate-600">正在加载项目...</main>}>
      <ProjectPageContent />
    </Suspense>
  );
}

function ProjectPageContent() {
  const searchParams = useSearchParams();
  const projectId = Number(searchParams.get("projectId") || 0);
  const [project, setProject] = useState<Project | null>(null);
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [providerTests, setProviderTests] = useState<Record<number, ProviderTestResult & { loading?: boolean }>>({});
  const [providerForm, setProviderForm] = useState({
    name: "模拟智能体",
    description: "用于本地演示的模拟智能体，不调用外部 API。",
    provider_type: "mock" as ProviderType,
    base_url: "",
    api_key: "",
    model_name: "mock-model",
    temperature: 0.7,
    max_tokens: 1200,
    enabled: true
  });
  const [workflowName, setWorkflowName] = useState("空白工作流");

  async function load() {
    setError("");
    try {
      const [projectResult, providerResult, fileResult, workflowResult, runResult] = await Promise.all([
        api.project(projectId),
        api.providers(projectId),
        api.files(projectId),
        api.workflows(projectId),
        api.projectRuns(projectId)
      ]);
      setProject(projectResult);
      setProviders(providerResult);
      setFiles(fileResult);
      setWorkflows(workflowResult);
      setRuns(runResult);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }

  useEffect(() => {
    load();
  }, [projectId]);

  async function createProvider(event: FormEvent) {
    event.preventDefault();
    setStatus("正在保存 API / 智能体...");
    try {
      await api.createProvider(projectId, providerForm);
      setStatus("API / 智能体已保存");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }

  async function addMockProvider() {
    setStatus("正在添加模拟智能体...");
    try {
      await api.createProvider(projectId, {
        name: `模拟智能体 ${providers.filter((item) => item.provider_type === "mock").length + 1}`,
        description: "本地模拟智能体，可用于多智能体工作流演示。",
        provider_type: "mock",
        base_url: "",
        api_key: "",
        model_name: "mock-model",
        temperature: 0.2,
        max_tokens: 1200,
        enabled: true
      });
      setStatus("模拟智能体已添加");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }

  async function testProvider(id: number) {
    setProviderTests((current) => ({
      ...current,
      [id]: {
        status: "running",
        content: "",
        error: null,
        loading: true
      }
    }));
    try {
      const result = await api.testProvider(id);
      setProviderTests((current) => ({
        ...current,
        [id]: { ...result, loading: false }
      }));
      setStatus(result.status === "success" ? "API / 智能体测试成功，结果已显示在卡片下方。" : "API / 智能体测试失败，错误详情已显示在卡片下方。");
    } catch (exc) {
      setProviderTests((current) => ({
        ...current,
        [id]: {
          status: "error",
          content: "",
          error: exc instanceof Error ? exc.message : String(exc),
          loading: false
        }
      }));
      setStatus("API / 智能体测试失败，错误详情已显示在卡片下方。");
    }
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("正在上传文件...");
    try {
      await api.uploadFile(projectId, file);
      setStatus("文件已上传");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }

  async function createWorkflowFromTemplate(templateId: string) {
    setStatus("正在创建工作流...");
    try {
      const template = workflowTemplates.find((item) => item.id === templateId) || workflowTemplates[0];
      const providerIds = providers.filter((item) => item.enabled).map((item) => item.id);
      const workflowJson = template.build(providerIds);
      const name = template.id === "blank" ? workflowName || "空白工作流" : template.name;
      workflowJson.name = name;
      const workflow = await api.createWorkflow(projectId, {
        name,
        description: template.scenario,
        workflow_json: workflowJson
      });
      navigateApp(workflowPath(projectId, workflow.id));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setStatus("");
    }
  }

  async function runWorkflow(id: number) {
    setStatus("正在运行工作流...");
    try {
      const run = await api.runWorkflow(id);
      setStatus(`运行完成：${run.status}`);
      navigateApp(runPath(run.id));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setStatus("");
    }
  }

  async function importWorkflow(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("正在导入 workflow.json...");
    try {
      const text = await file.text();
      const workflowJson = JSON.parse(text);
      const imported = await api.importWorkflow(projectId, { workflow_json: workflowJson });
      navigateApp(workflowPath(projectId, imported.id));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setStatus("");
    } finally {
      event.target.value = "";
    }
  }

  async function deleteProvider(id: number) {
    if (!confirm("确认删除该 API / 智能体？")) return;
    try {
      await api.deleteProvider(id);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }

  async function deleteWorkflow(id: number) {
    if (!confirm("确认删除该工作流？")) return;
    try {
      await api.deleteWorkflow(id);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }

  if (!projectId) {
    return <main className="p-6 text-sm text-red-700">缺少 projectId 参数。</main>;
  }

  if (!project) {
    return <main className="p-6 text-sm text-slate-600">正在加载项目...</main>;
  }

  return (
    <main className="min-h-screen px-6 py-6">
      <section className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/" className="text-sm text-blue-700">
              返回项目列表
            </Link>
            <h1 className="mt-2 text-2xl font-semibold">{project.name}</h1>
            <p className="text-sm text-slate-600">{project.description || "通用 AI 工作流项目"}</p>
          </div>
          <div className="text-xs text-slate-500">创建：{new Date(project.created_at).toLocaleString()}</div>
        </header>

        {error && <div className="panel border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {status && <div className="panel bg-blue-50 p-3 text-sm text-blue-800">{status}</div>}

        <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">API / 智能体配置</h2>
                <p className="mt-1 text-xs text-slate-500">先在这里配置多个 API / 智能体和用途描述，画布里的 API 节点再选择调用哪个智能体。</p>
              </div>
              <button className="btn" onClick={addMockProvider}>
                <FlaskConical size={16} />
                添加模拟智能体
              </button>
            </div>
            <form onSubmit={createProvider} className="grid gap-3 md:grid-cols-2">
              <div className="field">
                <label>智能体名称</label>
                <input className="input" value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} />
              </div>
              <div className="field md:col-span-2">
                <label>智能体描述 / 适用任务</label>
                <textarea className="input resize-y" rows={3} value={providerForm.description} onChange={(event) => setProviderForm({ ...providerForm, description: event.target.value })} />
              </div>
              <div className="field">
                <label>API 类型</label>
                <select className="input" value={providerForm.provider_type} onChange={(event) => setProviderForm({ ...providerForm, provider_type: event.target.value as ProviderType })}>
                  {providerTypes.map((type) => (
                    <option key={type} value={type}>{providerTypeLabels[type]}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>接口地址（Base URL）</label>
                <input className="input" value={providerForm.base_url} onChange={(event) => setProviderForm({ ...providerForm, base_url: event.target.value })} />
              </div>
              <div className="field">
                <label>API 密钥（API Key）</label>
                <input className="input" type="password" value={providerForm.api_key} onChange={(event) => setProviderForm({ ...providerForm, api_key: event.target.value })} />
              </div>
              <div className="field">
                <label>模型</label>
                <input className="input" value={providerForm.model_name} onChange={(event) => setProviderForm({ ...providerForm, model_name: event.target.value })} />
              </div>
              <button className="btn btn-primary self-end">
                <Plus size={16} />
                保存 API / 智能体
              </button>
            </form>

            <div className="mt-4 grid gap-2">
              {providers.map((provider) => (
                <div key={provider.id} className="rounded-tool border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong>{provider.name}</strong>
                      <span className="ml-2 text-xs text-slate-500">{provider.provider_type}</span>
                      <span className="ml-2 text-xs text-slate-500">密钥：{provider.api_key_masked || "无"}</span>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{provider.description || "未填写智能体描述"}</p>
                      <p className="mt-1 text-xs text-slate-400">模型：{provider.model_name || "未指定"} · 最大输出：{provider.max_tokens}</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn" disabled={providerTests[provider.id]?.loading} onClick={() => testProvider(provider.id)}>
                        {providerTests[provider.id]?.loading ? "测试中..." : "测试"}
                      </button>
                      <button className="btn btn-danger" onClick={() => deleteProvider(provider.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <ProviderTestPanel result={providerTests[provider.id]} />
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-4">
            <h2 className="mb-3 font-semibold">项目资源</h2>
            <label className="btn mb-3 cursor-pointer">
              <FileUp size={16} />
              上传 txt/md/pdf/docx/xlsx
              <input type="file" className="hidden" onChange={uploadFile} />
            </label>
            <div className="grid gap-2">
              {files.map((file) => (
                <div key={file.id} className="rounded-tool border border-line p-3 text-sm">
                  <strong>{file.original_name}</strong>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{file.extracted_text || "已保存文件，未提取文本"}</p>
                </div>
              ))}
              {!files.length && <p className="text-sm text-slate-500">暂无文件。文件输入节点会读取这里提取出的文本。</p>}
            </div>
          </div>
        </section>

        <section className="panel p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">模板库</h2>
              <p className="mt-1 text-xs text-slate-500">数学建模只是模板之一；空白工作流不会自动包含数学建模节点。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input className="input" value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} />
              <button className="btn btn-primary" onClick={() => createWorkflowFromTemplate("blank")}>
                <GitBranch size={16} />
                新建空白工作流
              </button>
              <label className="btn cursor-pointer">
                <Upload size={16} />
                导入 workflow.json
                <input type="file" accept=".json,application/json" className="hidden" onChange={importWorkflow} />
              </label>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workflowTemplates.map((template) => (
              <article key={template.id} className="rounded-tool border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{template.name}</h3>
                  {template.badge && <span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{template.badge}</span>}
                </div>
                <p className="mt-2 min-h-10 text-sm text-slate-600">{template.scenario}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>节点 {template.nodeCount}</span>
                  <span>{template.requiresApi ? "需要 API" : "可无 API"}</span>
                </div>
                <button className="btn mt-3 w-full" onClick={() => createWorkflowFromTemplate(template.id)}>
                  使用模板
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 font-semibold">工作流</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {workflows.map((workflow) => (
              <article key={workflow.id} className="rounded-tool border border-line p-4">
                <h3 className="font-semibold">{workflow.name}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  模板：{String(workflow.workflow_json.metadata?.template_name || "自定义")} · 节点 {workflow.workflow_json.nodes?.length || 0} / 连线 {workflow.workflow_json.edges?.length || 0}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link className="btn btn-primary" href={workflowPath(projectId, workflow.id)}>
                    打开画布
                  </Link>
                  <button className="btn" onClick={() => runWorkflow(workflow.id)}>
                    运行
                  </button>
                  <a className="btn" href={api.exportWorkflowUrl(workflow.id)}>
                    <Download size={16} />
                    导出
                  </a>
                  <button className="btn btn-danger" onClick={() => deleteWorkflow(workflow.id)}>
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 font-semibold">运行记录</h2>
          <div className="grid gap-2">
            {runs.map((run) => (
              <Link key={run.id} href={runPath(run.id)} className="rounded-tool border border-line p-3 text-sm hover:border-blue-300">
                运行 #{run.id} · 工作流 #{run.workflow_id} · <span className={run.status === "success" ? "text-emerald-700" : "text-red-600"}>{run.status}</span>
              </Link>
            ))}
            {!runs.length && <p className="text-sm text-slate-500">暂无运行记录。</p>}
          </div>
        </section>
      </section>
    </main>
  );
}

function ProviderTestPanel({ result }: { result?: ProviderTestResult & { loading?: boolean } }) {
  if (!result) return null;
  const isSuccess = result.status === "success";
  const isRunning = result.loading || result.status === "running";
  const rawText = formatRawResult(result.raw);
  return (
    <div className={`mt-3 rounded-tool border p-3 text-xs ${isRunning ? "border-blue-200 bg-blue-50 text-blue-800" : isSuccess ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <strong>{isRunning ? "正在测试 API / 智能体..." : isSuccess ? "测试成功：已收到明确输出" : "测试失败：未收到可用输出"}</strong>
        <span>
          {result.status_code ? `HTTP ${result.status_code}` : "本地测试"} {typeof result.duration_ms === "number" ? `· ${result.duration_ms} ms` : ""}
        </span>
      </div>
      {result.request_url && (
        <div className="mb-2 break-all">
          <span className="font-semibold">请求地址：</span>
          {result.request_url}
        </div>
      )}
      {result.model_name && (
        <div className="mb-2">
          <span className="font-semibold">模型：</span>
          {result.model_name}
        </div>
      )}
      {result.content && (
        <div className="mb-2">
          <div className="font-semibold">模型输出：</div>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-white/80 p-2 text-slate-800">{result.content}</pre>
        </div>
      )}
      {result.error && (
        <div className="mb-2">
          <div className="font-semibold">错误原因：</div>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-white/80 p-2 text-red-800">{result.error}</pre>
        </div>
      )}
      {rawText && (
        <details>
          <summary className="cursor-pointer font-semibold">查看原始响应摘要</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-white/80 p-2 text-slate-700">{rawText}</pre>
        </details>
      )}
    </div>
  );
}

function formatRawResult(raw: unknown) {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}
