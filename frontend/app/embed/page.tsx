"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Play, Workflow as WorkflowIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { Workflow, WorkflowRun, WorkflowRunStep } from "@/types/workflow";
import { JsonView } from "@/components/JsonView";

export default function EmbedWorkflowPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas p-4 text-sm text-slate-600">正在加载嵌入页...</main>}>
      <EmbedWorkflowPageContent />
    </Suspense>
  );
}

function EmbedWorkflowPageContent() {
  const searchParams = useSearchParams();
  const workflowId = searchParams.get("workflowId") || "";
  const id = Number(workflowId);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [input, setInput] = useState("");
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [steps, setSteps] = useState<WorkflowRunStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .workflow(id)
      .then((result) => {
        if (alive) setWorkflow(result);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  async function runWorkflow() {
    setRunning(true);
    setError("");
    setSteps([]);
    try {
      const result = await api.runWorkflow(id, { inputs: { input } });
      const runSteps = await api.runSteps(result.id);
      setRun(result);
      setSteps(runSteps);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas p-4">
      <section className="mx-auto max-w-4xl rounded-tool border border-line bg-white shadow-sm">
        <header className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <WorkflowIcon size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">嵌入式工作流运行器</p>
              <h1 className="mt-1 truncate text-lg font-semibold">{workflow?.name || `工作流 #${workflowId}`}</h1>
              <p className="mt-1 text-sm text-slate-500">{workflow?.description || "输入内容并运行当前工作流。"}</p>
            </div>
          </div>
          {loading && <Loader2 className="animate-spin text-slate-400" size={18} />}
        </header>

        <div className="grid gap-4 p-5 md:grid-cols-[320px_1fr]">
          <div className="space-y-3">
            <div className="field">
              <label>输入内容</label>
              <textarea
                className="input min-h-40 resize-y"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="你的输入内容"
              />
            </div>
            <button className="btn btn-primary w-full" onClick={runWorkflow} disabled={running || loading || !workflow}>
              {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {running ? "运行中" : "运行工作流"}
            </button>
            {error && <div className="rounded-tool border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <div className="rounded-tool border border-line bg-slate-50 p-3 text-xs leading-5 text-slate-500">
              当前嵌入页用于本地或内网演示。第一版会把输入发送给运行 API；若后端 runner 未消费 payload，则以工作流节点内配置输入为准。
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <section>
              <h2 className="mb-2 text-sm font-semibold">运行输出</h2>
              <JsonView value={run?.final_output || { status: run?.status || "未开始" }} />
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold">节点步骤</h2>
              {steps.length ? (
                <div className="overflow-hidden rounded-tool border border-line">
                  {steps.map((step, index) => (
                    <div key={step.id} className="grid grid-cols-[40px_1fr_88px] items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0">
                      <span className="text-slate-400">{index + 1}</span>
                      <span className="truncate">{step.node_id}</span>
                      <span className={step.status === "success" ? "text-emerald-700" : step.status === "error" ? "text-red-600" : "text-slate-500"}>{step.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-tool border border-line bg-slate-50 p-3 text-sm text-slate-500">运行后显示每个节点的执行状态。</p>
              )}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
