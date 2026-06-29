export function appPath(path: string) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  if (!basePath) return path;
  if (path === "/") return `${basePath}/`;
  return `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
}

export function projectPath(projectId: number) {
  return `/projects?projectId=${projectId}`;
}

export function workflowPath(projectId: number, workflowId: number) {
  return `/workflows?projectId=${projectId}&workflowId=${workflowId}`;
}

export function runPath(runId: number) {
  return `/runs?runId=${runId}`;
}

export function embedWorkflowPath(workflowId: number) {
  return `/embed?workflowId=${workflowId}`;
}

export function navigateApp(path: string) {
  window.location.href = appPath(path);
}
