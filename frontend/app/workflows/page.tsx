"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { ApiProvider, FileAsset, Workflow } from "@/types/workflow";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";

export default function WorkflowPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-slate-600">正在加载画布...</main>}>
      <WorkflowPageContent />
    </Suspense>
  );
}

function WorkflowPageContent() {
  const searchParams = useSearchParams();
  const projectId = Number(searchParams.get("projectId") || 0);
  const workflowId = Number(searchParams.get("workflowId") || 0);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.workflow(workflowId), api.providers(projectId), api.files(projectId)])
      .then(([workflowResult, providerResult, fileResult]) => {
        setWorkflow(workflowResult);
        setProviders(providerResult);
        setFiles(fileResult);
      })
      .catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
  }, [projectId, workflowId]);

  if (!projectId || !workflowId) return <main className="p-6 text-sm text-red-700">缺少 projectId 或 workflowId 参数。</main>;
  if (error) return <main className="p-6 text-sm text-red-700">{error}</main>;
  if (!workflow) return <main className="p-6 text-sm text-slate-600">正在加载画布...</main>;
  return <WorkflowCanvas workflow={workflow} providers={providers} files={files} />;
}
