"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { WorkflowRun, WorkflowRunStep } from "@/types/workflow";
import { JsonView } from "@/components/JsonView";

type Props = { params: Promise<{ runId: string }> };

export default function RunDetailPage({ params }: Props) {
  const { runId: runIdParam } = use(params);
  const runId = Number(runIdParam);
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [steps, setSteps] = useState<WorkflowRunStep[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.run(runId), api.runSteps(runId)])
      .then(([runResult, stepResult]) => {
        setRun(runResult);
        setSteps(stepResult);
      })
      .catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
  }, [runId]);

  if (error) return <main className="p-6 text-sm text-red-700">{error}</main>;
  if (!run) return <main className="p-6 text-sm text-slate-600">正在加载运行详情...</main>;

  return (
    <main className="min-h-screen px-6 py-6">
      <section className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/projects/${run.project_id}`} className="text-sm text-blue-700">
              返回项目
            </Link>
            <h1 className="mt-2 text-2xl font-semibold">运行 #{run.id}</h1>
            <p className="text-sm text-slate-600">
              工作流 #{run.workflow_id} · 状态 <span className={run.status === "success" ? "text-emerald-700" : "text-red-600"}>{run.status}</span>
            </p>
          </div>
          <div className="text-xs text-slate-500">
            开始：{run.started_at ? new Date(run.started_at).toLocaleString() : "-"}
            <br />
            结束：{run.finished_at ? new Date(run.finished_at).toLocaleString() : "-"}
          </div>
        </header>

        <section className="panel p-4">
          <h2 className="mb-3 font-semibold">最终输出</h2>
          <JsonView value={run.final_output} />
        </section>

        <section className="grid gap-3">
          {steps.map((step) => (
            <article key={step.id} className="panel p-4">
              {(() => {
                const input = step.input_json || {};
                const contextDetail = {
                  context_package: input.context_package || {},
                  retrieved_material_chunks: input.retrieved_material_chunks || [],
                  source_refs: input.source_refs || [],
                  missing_information: input.missing_information || [],
                  retry_info: input.retry_info || {}
                };
                return (
                  <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">
                  {step.node_id} <span className="text-sm font-normal text-slate-500">({step.node_type})</span>
                </h2>
                <div className="text-sm">
                  <span className={step.status === "success" ? "text-emerald-700" : "text-red-600"}>{step.status}</span>
                  <span className="ml-3 text-slate-500">{step.duration_ms} ms</span>
                </div>
              </div>
              {step.error_message && <div className="mb-3 rounded-tool border border-red-200 bg-red-50 p-3 text-sm text-red-700">{step.error_message}</div>}
              <div className="mb-3">
                <h3 className="mb-2 text-sm font-semibold">上下文包 / 资料检索</h3>
                <JsonView value={contextDetail} />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">输入 JSON（input_json）</h3>
                  <JsonView value={step.input_json} />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">输出 JSON（output_json）</h3>
                  <JsonView value={step.output_json} />
                </div>
              </div>
                  </>
                );
              })()}
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
