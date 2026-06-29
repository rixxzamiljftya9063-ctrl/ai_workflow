"use client";

import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ApiProvider, FileAsset, Workflow } from "@/types/workflow";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";

type Props = { params: Promise<{ projectId: string; workflowId: string }> };

export default function WorkflowPage({ params }: Props) {
  const { projectId: projectIdParam, workflowId: workflowIdParam } = use(params);
  const projectId = Number(projectIdParam);
  const workflowId = Number(workflowIdParam);
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

  if (error) return <main className="p-6 text-sm text-red-700">{error}</main>;
  if (!workflow) return <main className="p-6 text-sm text-slate-600">正在加载画布...</main>;
  return <WorkflowCanvas workflow={workflow} providers={providers} files={files} />;
}
