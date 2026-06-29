"use client";

import { ChangeEvent, DragEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import {
  BadgeCheck,
  Bot,
  Boxes,
  Brain,
  Braces,
  CheckSquare,
  ChevronDown,
  CircleCheck,
  ClipboardList,
  Code2,
  Combine,
  Copy,
  Database,
  Download,
  FileText,
  FileType,
  FileUp,
  Focus,
  GitBranch,
  GitCompare,
  LayoutGrid,
  LayoutTemplate,
  Link as LinkIcon,
  Link2,
  ListChecks,
  MessageCircle,
  Merge,
  Network,
  PanelTop,
  Play,
  Presentation,
  RefreshCcw,
  RotateCcw,
  Repeat,
  Route,
  Save,
  Scissors,
  Search,
  Send,
  ShieldCheck,
  Split,
  Square,
  Table,
  Terminal,
  Type,
  Upload,
  UserCheck,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from "lucide-react";
import { API_BASE, api } from "@/lib/api";
import { appPath, embedWorkflowPath, projectPath } from "@/lib/routes";
import { fromReactFlow, makeReactNode, nodeCatalog, nodeCategories, nodeColor, toReactFlow, type NodeCatalogItem, type NodeCategory } from "@/lib/workflow";
import { workflowTemplates } from "@/lib/workflowTemplates";
import type { ApiProvider, FileAsset, NodeRunStatus, Workflow, WorkflowJson, WorkflowRun, WorkflowRunStep } from "@/types/workflow";
import { NodeConfigPanel } from "@/components/NodeConfigPanel";
import { JsonView } from "@/components/JsonView";
import { CustomWorkflowNode } from "@/components/CustomWorkflowNode";
import { WorkflowChatPanel } from "@/components/WorkflowChatPanel";

type Props = {
  workflow: Workflow;
  providers: ApiProvider[];
  files: FileAsset[];
};

const nodeTypes = { workflowNode: CustomWorkflowNode };

const iconMap: Record<string, LucideIcon> = {
  BadgeCheck,
  Bot,
  Brain,
  Braces,
  CheckSquare,
  CircleCheck,
  ClipboardList,
  Code2,
  Combine,
  Database,
  Download,
  FileText,
  FileType,
  FileUp,
  GitBranch,
  GitCompare,
  Link: LinkIcon,
  ListChecks,
  MessageCircle,
  Merge,
  Network,
  Presentation,
  RefreshCcw,
  Repeat,
  Route,
  Save,
  Scissors,
  Search,
  Send,
  ShieldCheck,
  Split,
  Table,
  Terminal,
  Type,
  UserCheck
};

function edgeDefaults(): Partial<Edge> {
  return {
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#64748b" },
    style: { stroke: "#64748b", strokeWidth: 1.8 }
  };
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  if (["input", "textarea", "select"].includes(tagName)) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner({ workflow, providers, files }: Props) {
  const initial = useMemo(() => toReactFlow(workflow.workflow_json), [workflow.workflow_json]);
  const [projectFiles, setProjectFiles] = useState<FileAsset[]>(files);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [status, setStatus] = useState("已加载");
  const [dirty, setDirty] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [nodeSearch, setNodeSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    input: true,
    ai: true,
    logic: true,
    data: true,
    tool: true,
    output: true,
    check: true
  });
  const [templateOpen, setTemplateOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [lastRun, setLastRun] = useState<WorkflowRun | null>(null);
  const [runSteps, setRunSteps] = useState<WorkflowRunStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [base, setBase] = useState<WorkflowJson>(workflow.workflow_json);
  const runAbortRef = useRef<AbortController | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const reactFlow = useRef<Pick<ReactFlowInstance, "fitView" | "zoomIn" | "zoomOut" | "screenToFlowPosition"> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) || null;
  const selectedStep = selectedNodeId ? runSteps.find((step) => step.node_id === selectedNodeId) || null : null;
  const activeOutputStep = selectedStep || runSteps.find((step) => step.status === "running") || runSteps[runSteps.length - 1] || null;
  const workflowDraft = fromReactFlow(base, nodes, edges);
  async function refreshFiles() {
    setProjectFiles(await api.files(workflow.project_id));
  }
  const filteredCatalog = useMemo(() => {
    const term = nodeSearch.trim().toLowerCase();
    if (!term) return nodeCatalog;
    return nodeCatalog.filter((item) => `${item.label} ${item.type} ${item.description}`.toLowerCase().includes(term));
  }, [nodeSearch]);
  function markDirty(message = "未保存") {
    setDirty(true);
    setStatus(message);
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        if (!connection.source || !connection.target) return eds;
        if (connection.source === connection.target) return eds;
        if (eds.some((edge) => edge.source === connection.source && edge.target === connection.target)) return eds;
        return addEdge({ ...edgeDefaults(), ...connection, id: `edge-${connection.source}-${connection.target}-${Date.now()}` }, eds);
      });
      markDirty();
    },
    [setEdges]
  );

  function onDragStart(event: DragEvent<HTMLDivElement>, nodeType: string) {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  }

  function applyTemplate(templateId: string) {
    const template = workflowTemplates.find((item) => item.id === templateId) || workflowTemplates[0];
    const providerIds = providers.filter((item) => item.enabled).map((item) => item.id);
    const workflowJson = template.build(providerIds);
    const converted = toReactFlow(workflowJson);
    setBase({ ...workflowJson, id: base.id || workflowJson.id });
    setNodes(converted.nodes);
    setEdges(converted.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setTemplateOpen(false);
    markDirty(`未保存：已加载模板 ${template.name}`);
    window.setTimeout(() => reactFlow.current?.fitView({ padding: 0.18 }), 50);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData("application/reactflow");
    if (!nodeType || !reactFlow.current) return;
    const position = reactFlow.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const node = makeReactNode(nodeType, position, `${nodeType}_${crypto.randomUUID()}`);
    setNodes((items) => [...items, node]);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    markDirty("未保存：已添加节点");
  }

  function updateNode(nodeId: string, patch: { label?: string; description?: string; config?: Record<string, unknown> }) {
    setNodes((items) =>
      items.map((item) =>
        item.id === nodeId
          ? {
              ...item,
              data: {
                ...item.data,
                label: patch.label ?? item.data.label,
                description: patch.description ?? item.data.description,
                config: patch.config ?? item.data.config
              }
            }
          : item
      )
    );
    markDirty("未保存：节点配置已修改");
  }

  const updateInlineNodeConfig = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      setNodes((items) =>
        items.map((item) => {
          if (item.id !== nodeId) return item;
          const currentConfig = (item.data?.config as Record<string, unknown>) || {};
          return {
            ...item,
            data: {
              ...item.data,
              config: { ...currentConfig, ...patch }
            }
          };
        })
      );
      markDirty("未保存：节点配置已修改");
    },
    [setNodes]
  );

  function updateEdge(edgeId: string, patch: { condition?: string; transfer_mode?: string; selected_paths?: unknown[] }) {
    setEdges((items) =>
      items.map((item) =>
        item.id === edgeId
          ? {
              ...item,
              label: patch.condition !== undefined ? patch.condition?.trim() || undefined : item.label,
              data: {
                ...(item.data || {}),
                ...(patch.condition !== undefined ? { condition: patch.condition?.trim() || null } : {}),
                ...(patch.transfer_mode !== undefined ? { transfer_mode: patch.transfer_mode } : {}),
                ...(patch.selected_paths !== undefined ? { selected_paths: patch.selected_paths } : {})
              }
            }
          : item
      )
    );
    markDirty("未保存：连线路由已修改");
  }

  function deleteSelected() {
    if (selectedNodeId) {
      const hasEdges = edges.some((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId);
      if (hasEdges && !confirm("该节点已有连线，删除节点会同时删除相关边。确认删除？")) return;
      setNodes((items) => items.filter((item) => item.id !== selectedNodeId));
      setEdges((items) => items.filter((item) => item.source !== selectedNodeId && item.target !== selectedNodeId));
      setSelectedNodeId(null);
      markDirty("未保存：已删除节点");
      return;
    }
    if (selectedEdgeId) {
      setEdges((items) => items.filter((item) => item.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      markDirty("未保存：已删除连线");
    }
  }

  function addClickEdge(source: string, target: string) {
    if (source === target) {
      setStatus("不能创建自连线");
      return;
    }
    if (edges.some((edge) => edge.source === source && edge.target === target)) {
      setStatus("该连线已存在");
      return;
    }
    setEdges((items) => [
      ...items,
      {
        ...edgeDefaults(),
        id: `edge-${source}-${target}-${Date.now()}`,
        source,
        target,
        sourceHandle: "source",
        targetHandle: "target"
      } as Edge
    ]);
    setConnectSourceId(null);
    markDirty("未保存：已创建连线");
  }

  function handleNodeClick(node: Node) {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    if (!connectMode) return;
    if (!connectSourceId) {
      setConnectSourceId(node.id);
      setStatus(`连线模式：已选择 ${String(node.data?.label || node.id)}，请选择目标节点`);
      return;
    }
    addClickEdge(connectSourceId, node.id);
  }

  function buildWorkflowJson() {
    return fromReactFlow(base, nodes, edges);
  }

  async function save() {
    setStatus("正在保存...");
    try {
      const workflowJson = buildWorkflowJson();
      const saved = await api.updateWorkflow(workflow.id, {
        name: workflowJson.name || workflow.name,
        description: String(workflowJson.metadata?.description || workflow.description || ""),
        workflow_json: workflowJson
      });
      setBase(saved.workflow_json);
      setDirty(false);
      setStatus("已保存");
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  function applyRunResult(runResult: WorkflowRun, steps: WorkflowRunStep[], mode: "workflow" | "node", targetNodeId?: string, complete = true) {
    setLastRun(runResult);
    setRunSteps(steps);
    setNodes((items) =>
      items.map((node) => {
        const step = steps.find((item) => item.node_id === node.id);
        if (!step && mode === "node") return node;
        if (!step && !complete) {
          return {
            ...node,
            data: {
              ...node.data,
              status: node.data?.status === "running" ? ("pending" as NodeRunStatus) : node.data?.status || ("pending" as NodeRunStatus),
              lastRunError: ""
            }
          };
        }
        return {
          ...node,
          data: {
            ...node.data,
            status: ((step?.status as NodeRunStatus) || (complete && mode === "workflow" ? "skipped" : node.data?.status) || "pending"),
            lastRunOutput: step?.output_json || node.data?.lastRunOutput || null,
            lastRunError: step?.error_message || ""
          }
        };
      })
    );
    if (mode === "node" && targetNodeId) {
      setSelectedNodeId(targetNodeId);
    }
  }

  async function pollRunUntilComplete(runId: number, mode: "workflow" | "node", targetNodeId?: string) {
    while (!runAbortRef.current?.signal.aborted) {
      const [runResult, steps] = await Promise.all([api.run(runId), api.runSteps(runId)]);
      const complete = !["queued", "running"].includes(runResult.status);
      applyRunResult(runResult, steps, mode, targetNodeId, complete);
      if (steps.length && !selectedNodeIdRef.current) {
        const activeStep = steps.find((step) => step.status === "running") || steps[steps.length - 1];
        setSelectedNodeId(activeStep.node_id);
      }
      if (complete) {
        return runResult;
      }
      await delay(800);
    }
    throw new DOMException("Run aborted", "AbortError");
  }

  async function run() {
    if (isRunning) return;
    await save();
    setStatus("正在按箭头顺序逐个执行...");
    setIsRunning(true);
    const controller = new AbortController();
    runAbortRef.current = controller;
    setRunSteps([]);
    setNodes((items) =>
      items.map((node) => ({
        ...node,
        data: {
          ...node.data,
          status: "pending" as NodeRunStatus,
          lastRunOutput: null,
          lastRunError: ""
        }
      }))
    );
    try {
      const runResult = await api.runWorkflowAsync(workflow.id, {}, controller.signal);
      setActiveRunId(runResult.id);
      setLastRun(runResult);
      const finalRun = await pollRunUntilComplete(runResult.id, "workflow");
      setStatus(`运行完成：${finalRun.status}`);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setStatus(aborted ? "已停止运行" : `运行失败：${error instanceof Error ? error.message : String(error)}`);
      setNodes((items) =>
        items.map((node) =>
          node.data?.status === "running"
            ? {
                ...node,
                data: {
                  ...node.data,
                  status: aborted ? ("stopped" as NodeRunStatus) : ("pending" as NodeRunStatus),
                  lastRunError: aborted ? "已停止" : node.data?.lastRunError || ""
                }
              }
            : node
        )
      );
    } finally {
      setIsRunning(false);
      setActiveRunId(null);
      runAbortRef.current = null;
    }
  }

  async function rerunNode(nodeId: string) {
    if (isRunning) return;
    await save();
    setStatus(`正在重新运行节点：${nodeId}`);
    setIsRunning(true);
    const controller = new AbortController();
    runAbortRef.current = controller;
    setSelectedNodeId(nodeId);
    setNodes((items) => items.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, status: "running" as NodeRunStatus, lastRunError: "" } } : node)));
    try {
      const runResult = await api.runWorkflowNodeAsync(workflow.id, nodeId, controller.signal);
      setActiveRunId(runResult.id);
      setLastRun(runResult);
      const finalRun = await pollRunUntilComplete(runResult.id, "node", nodeId);
      setStatus(`节点重新运行完成：${finalRun.status}`);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setStatus(aborted ? "已停止节点重新运行" : `节点重新运行失败：${error instanceof Error ? error.message : String(error)}`);
      setNodes((items) => items.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, status: aborted ? "stopped" as NodeRunStatus : "error" as NodeRunStatus, lastRunError: aborted ? "已停止" : error instanceof Error ? error.message : String(error) } } : node)));
    } finally {
      setIsRunning(false);
      setActiveRunId(null);
      runAbortRef.current = null;
    }
  }

  async function stopRunning() {
    setStatus("正在停止...");
    try {
      if (activeRunId) {
        await api.stopRun(activeRunId);
      }
      await api.stopWorkflow(workflow.id);
    } catch (error) {
      setStatus(`停止请求失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      runAbortRef.current?.abort();
      setIsRunning(false);
      setActiveRunId(null);
      setNodes((items) => items.map((node) => (node.data?.status === "running" ? { ...node, data: { ...node.data, status: "stopped" as NodeRunStatus, lastRunError: "已停止" } } : node)));
      setStatus("已停止运行");
    }
  }

  const enrichedNodes: Node[] = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      connectMode,
      connectSourceId,
      providers,
      isBusy: isRunning,
      onInlineConfigChange: updateInlineNodeConfig,
      onRerunNode: rerunNode
    }
  }));

  function exportLocal() {
    const data = buildWorkflowJson();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `workflow-${workflow.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importWorkflow(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = JSON.parse(await file.text()) as WorkflowJson;
    const converted = toReactFlow(parsed);
    setBase({ ...parsed, id: base.id || parsed.id });
    setNodes(converted.nodes);
    setEdges(converted.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    markDirty("未保存：已导入 workflow.json");
    event.target.value = "";
  }

  function autoLayout() {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    nodes.forEach((node) => {
      incoming.set(node.id, 0);
      outgoing.set(node.id, []);
    });
    edges.forEach((edge) => {
      incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
      outgoing.get(edge.source)?.push(edge.target);
    });
    const queue = nodes.filter((node) => (incoming.get(node.id) || 0) === 0).map((node) => node.id);
    const level = new Map<string, number>();
    queue.forEach((id) => level.set(id, 0));
    while (queue.length) {
      const id = queue.shift()!;
      for (const target of outgoing.get(id) || []) {
        level.set(target, Math.max(level.get(target) || 0, (level.get(id) || 0) + 1));
        incoming.set(target, (incoming.get(target) || 0) - 1);
        if ((incoming.get(target) || 0) === 0) queue.push(target);
      }
    }
    const rows = new Map<number, number>();
    setNodes((items) =>
      items.map((node, index) => {
        const column = level.get(node.id) ?? index;
        const row = rows.get(column) || 0;
        rows.set(column, row + 1);
        return { ...node, position: { x: 80 + column * 300, y: 80 + row * 170 } };
      })
    );
    markDirty("未保存：已自动布局");
    window.setTimeout(() => reactFlow.current?.fitView({ padding: 0.18 }), 50);
  }

  function addTextInputNode() {
    const node = makeReactNode("text_input", { x: 120, y: 120 }, `text_input_${crypto.randomUUID()}`);
    setNodes((items) => [...items, node]);
    setSelectedNodeId(node.id);
    markDirty("未保存：已添加文本输入节点");
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
      return;
    }
    if (isEditableKeyboardTarget(event.target)) {
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
      return;
    }
    if (event.key === "Escape") {
      setConnectMode(false);
      setConnectSourceId(null);
      setTemplateOpen(false);
      setEmbedOpen(false);
      setStatus(dirty ? "未保存" : "已保存");
    }
  }

  return (
    <div className="grid h-screen grid-cols-[300px_1fr_380px] grid-rows-[60px_1fr_220px] bg-canvas" onKeyDown={onKeyDown} tabIndex={0}>
      <header className="col-span-3 flex items-center justify-between border-b border-line bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <a className="btn" href={projectPath(workflow.project_id)}>
            返回项目
          </a>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{workflowDraft.name || workflow.name}</h1>
            <p className="truncate text-xs text-slate-500">拖节点 → 连线 → 配置 → 运行 → 导出/嵌入</p>
          </div>
          <span className={`rounded px-2 py-1 text-xs ${dirty ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{status}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => setTemplateOpen(true)}>
            <LayoutTemplate size={16} />
            模板
          </button>
          <button className="btn" onClick={save} disabled={isRunning}>
            <Save size={16} />
            保存
          </button>
          <button className="btn btn-primary" onClick={run} disabled={isRunning}>
            <Play size={16} />
            运行
          </button>
          <button className="btn btn-danger" onClick={stopRunning} disabled={!isRunning}>
            <Square size={16} />
            停止
          </button>
          {selectedNodeId && (
            <button className="btn" onClick={() => rerunNode(selectedNodeId)} disabled={isRunning}>
              <RotateCcw size={16} />
              重跑节点
            </button>
          )}
          <label className="btn cursor-pointer">
            <Upload size={16} />
            导入
            <input type="file" accept=".json,application/json" className="hidden" onChange={importWorkflow} />
          </label>
          <button className="btn" onClick={exportLocal}>
            <Download size={16} />
            导出
          </button>
          <button className="btn" onClick={() => setEmbedOpen(true)}>
            <PanelTop size={16} />
            嵌入
          </button>
          <button className="btn" onClick={autoLayout}>
            <LayoutGrid size={16} />
            自动布局
          </button>
          <button
            className={`btn ${connectMode ? "btn-primary" : ""}`}
            onClick={() => {
              setConnectMode((value) => !value);
              setConnectSourceId(null);
              setStatus(!connectMode ? "连线模式：请选择源节点" : dirty ? "未保存" : "已保存");
            }}
          >
            <Link2 size={16} />
            连线模式
          </button>
          <button className="btn btn-danger" onClick={deleteSelected}>
            <Scissors size={16} />
            删除
          </button>
          <button className="btn" onClick={() => reactFlow.current?.fitView({ padding: 0.18 })} title="适应视图">
            <Focus size={16} />
          </button>
          <button className="btn" onClick={() => reactFlow.current?.zoomIn()} title="放大">
            <ZoomIn size={16} />
          </button>
          <button className="btn" onClick={() => reactFlow.current?.zoomOut()} title="缩小">
            <ZoomOut size={16} />
          </button>
        </div>
      </header>

      <aside className="row-span-2 overflow-auto border-r border-line bg-white">
        <div className="border-b border-line p-3">
          <h2 className="text-sm font-semibold">图标化节点库</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">核心模型是 API 调用 → 技能节点 → 交叉验证。节点完整输出后再沿箭头传递给下游。</p>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2 top-2.5 text-slate-400" size={14} />
            <input className="input w-full pl-8" placeholder="搜索节点名称、类型或说明" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} />
          </div>
        </div>

        <div className="space-y-2 p-3">
          {nodeCategories.map((category) => {
            const items = filteredCatalog.filter((item) => item.category === category.id);
            if (!items.length) return null;
            const isCollapsed = collapsed[category.id];
            return (
              <section key={category.id} className="rounded-tool border border-line bg-slate-50">
                <button
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold"
                  onClick={() => setCollapsed((value) => ({ ...value, [category.id]: !value[category.id] }))}
                >
                  <span>{category.label}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {items.length}
                    <ChevronDown size={14} className={isCollapsed ? "-rotate-90" : ""} />
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="grid gap-2 border-t border-line p-2">
                    {items.map((item) => (
                      <NodeLibraryCard key={item.type} item={item} onDragStart={onDragStart} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>

      <section className="relative" ref={wrapperRef}>
        {!nodes.length && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-tool border border-dashed border-slate-300 bg-white/95 px-6 py-5 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                <Boxes size={20} />
              </div>
              <h3 className="text-base font-semibold">从左侧拖拽节点，开始搭建 AI 工作流</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">适用于论文、PPT、数据分析、代码审查、知识库问答、数学建模等场景。</p>
              <p className="mt-1 text-xs text-slate-400">拖节点 → 连线 → 配置 → 运行 → 导出/嵌入</p>
              <div className="mt-4 flex justify-center gap-2">
                <button className="btn btn-primary" onClick={() => setTemplateOpen(true)}>
                  使用模板
                </button>
                <label className="btn cursor-pointer">
                  导入 workflow.json
                  <input type="file" accept=".json,application/json" className="hidden" onChange={importWorkflow} />
                </label>
                <button className="btn" onClick={addTextInputNode}>
                  添加文本输入节点
                </button>
              </div>
            </div>
          </div>
        )}
        <ReactFlow
          nodes={enrichedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            reactFlow.current = instance;
          }}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            if (changes.some((change) => change.type !== "select")) markDirty();
          }}
          onEdgesChange={(changes) => {
            onEdgesChange(changes);
            if (changes.some((change) => change.type !== "select")) markDirty();
          }}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeClick={(_, node) => handleNodeClick(node)}
          onEdgeClick={(_, edge) => {
            setSelectedEdgeId(edge.id);
            setSelectedNodeId(null);
          }}
          onPaneClick={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
            if (connectMode) {
              setConnectSourceId(null);
              setStatus("连线模式：请选择源节点");
            }
          }}
          fitView
          deleteKeyCode={null}
          selectionOnDrag
          multiSelectionKeyCode="Shift"
        >
          <Background gap={18} color="#d8dee8" />
          <MiniMap nodeColor={(node) => nodeColor(String(node.data?.node_type || ""))} pannable zoomable />
          <Controls showInteractive={false} />
        </ReactFlow>
        <WorkflowChatPanel node={selectedNode} providers={providers} onConfigChange={updateInlineNodeConfig} />
      </section>

      <aside className="row-span-2 flex min-h-0 flex-col border-l border-line bg-white">
        <div className="min-h-0 flex-1">
          <NodeConfigPanel
            node={selectedNode}
            edge={selectedEdge}
            projectId={workflow.project_id}
            providers={providers}
            files={projectFiles}
            workflow={workflowDraft}
            runStep={selectedStep}
            onWorkflowChange={(nextWorkflow) => {
              setBase(nextWorkflow);
              markDirty("未保存：工作流配置已修改");
            }}
            onChange={updateNode}
            onFilesChange={refreshFiles}
            onEdgeChange={updateEdge}
          />
        </div>
        <LiveOutputPanel step={activeOutputStep} steps={runSteps} isRunning={isRunning} onSelectStep={(nodeId) => setSelectedNodeId(nodeId)} />
      </aside>

      <footer className="border-t border-line bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">运行日志</h2>
          <span className="text-xs text-slate-500">Ctrl+S 保存 · 删除键删除 · Esc 退出连线模式</span>
        </div>
        {runSteps.length ? (
          <div className="grid h-[160px] grid-cols-[360px_1fr] gap-3 overflow-hidden text-sm">
            <div className="overflow-auto rounded-tool border border-line">
              {runSteps.map((step, index) => (
                <button key={step.id} className="flex w-full items-center justify-between border-b border-line px-3 py-2 text-left last:border-b-0" onClick={() => setSelectedNodeId(step.node_id)}>
                  <span>
                    {index + 1}. {step.node_id}
                  </span>
                  <span className={step.status === "success" ? "text-emerald-700" : "text-red-600"}>{step.status}</span>
                </button>
              ))}
            </div>
            <JsonView value={lastRun?.final_output || {}} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">运行后会显示节点执行顺序、状态、错误和最终输出摘要。</p>
        )}
      </footer>

      {templateOpen && <TemplateModal onClose={() => setTemplateOpen(false)} onApply={applyTemplate} />}
      {embedOpen && <EmbedModal workflowId={workflow.id} onClose={() => setEmbedOpen(false)} />}
    </div>
  );
}

function NodeLibraryCard({ item, onDragStart }: { item: NodeCatalogItem; onDragStart: (event: DragEvent<HTMLDivElement>, nodeType: string) => void }) {
  const Icon = iconMap[item.icon] || Bot;
  return (
    <div
      draggable
      onDragStart={(event) => onDragStart(event, item.type)}
      className="rounded-tool border border-line bg-white p-3 transition hover:border-blue-300 hover:shadow-sm active:cursor-grabbing"
    >
      <div className="flex cursor-grab items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white" style={{ background: item.color }}>
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{item.label}</div>
          <div className="truncate text-[11px] text-slate-500">{item.type}</div>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{item.description}</p>
    </div>
  );
}

function LiveOutputPanel({
  step,
  steps,
  isRunning,
  onSelectStep
}: {
  step: WorkflowRunStep | null;
  steps: WorkflowRunStep[];
  isRunning: boolean;
  onSelectStep: (nodeId: string) => void;
}) {
  return (
    <section className="flex h-[340px] min-h-[260px] flex-col border-t border-line bg-slate-50">
      <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">实时节点输出</h2>
          <p className="mt-0.5 text-xs text-slate-500">节点运行时会在这里显示输入、输出和状态。</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs ${isRunning ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
          {isRunning ? "运行中" : "空闲"}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[126px_1fr] gap-2 p-3 text-xs">
        <div className="min-h-0 overflow-auto rounded-tool border border-line bg-white">
          {steps.length ? (
            steps.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`block w-full border-b border-line px-2 py-2 text-left last:border-b-0 ${step?.id === item.id ? "bg-blue-50 text-blue-800" : "hover:bg-slate-50"}`}
                onClick={() => onSelectStep(item.node_id)}
              >
                <div className="truncate font-medium">
                  {index + 1}. {item.node_id}
                </div>
                <div className={statusTextClass(item.status)}>{item.status}</div>
              </button>
            ))
          ) : (
            <div className="p-3 text-slate-500">运行后显示节点列表。</div>
          )}
        </div>
        <div className="min-h-0 overflow-auto rounded-tool border border-line bg-white p-3">
          {step ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <OutputMetric label="节点" value={step.node_id} />
                <OutputMetric label="状态" value={step.status} />
                <OutputMetric label="类型" value={step.node_type} />
                <OutputMetric label="耗时" value={step.finished_at ? `${step.duration_ms} ms` : "运行中"} />
              </div>
              {step.error_message ? <div className="rounded-tool border border-red-200 bg-red-50 p-2 text-red-700">{step.error_message}</div> : null}
              <div>
                <h3 className="mb-1 font-semibold text-slate-700">执行策略 / API 调用</h3>
                <JsonView value={executionTrace(step.output_json)} />
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-slate-700">上下文包 / 资料检索</h3>
                <JsonView
                  value={{
                    context_package: (step.input_json as Record<string, unknown> | null)?.context_package || {},
                    retrieved_material_chunks: (step.input_json as Record<string, unknown> | null)?.retrieved_material_chunks || [],
                    source_refs: (step.input_json as Record<string, unknown> | null)?.source_refs || [],
                    missing_information: (step.input_json as Record<string, unknown> | null)?.missing_information || [],
                    retry_info: (step.input_json as Record<string, unknown> | null)?.retry_info || {}
                  }}
                />
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-slate-700">输出 JSON（output_json）</h3>
                <JsonView value={step.output_json || (step.status === "running" ? { status: "running", message: "当前节点正在执行，完成后这里会出现输出。" } : null)} />
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-slate-700">输入 JSON（input_json）</h3>
                <JsonView value={step.input_json} />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-tool border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-slate-500">
              点击运行后，当前执行节点和每个节点的输出会显示在这里。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function statusTextClass(status: string) {
  if (status === "success") return "text-emerald-700";
  if (status === "error" || status === "failed") return "text-red-600";
  if (status === "running") return "text-blue-700";
  if (status === "stopped") return "text-slate-600";
  return "text-slate-500";
}

function OutputMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-tool border border-line bg-slate-50 p-2">
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-slate-700">{value}</div>
    </div>
  );
}

function executionTrace(output: Record<string, unknown> | null) {
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

function TemplateModal({ onClose, onApply }: { onClose: () => void; onApply: (templateId: string) => void }) {
  return (
    <Modal title="模板库" description="模板只在这里加载，左侧节点库保持通用节点。" onClose={onClose}>
      <div className="grid max-h-[68vh] gap-3 overflow-auto md:grid-cols-2">
        {workflowTemplates.map((template) => (
          <div key={template.id} className="rounded-tool border border-line bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{template.name}</h3>
                <p className="mt-1 text-xs text-slate-500">节点 {template.nodeCount} · {template.requiresApi ? "需要 API / 智能体" : "可无 API"}</p>
              </div>
              {template.badge && <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">{template.badge}</span>}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">{template.scenario}</p>
            <button className="btn mt-3 w-full" onClick={() => onApply(template.id)}>
              使用模板
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function EmbedModal({ workflowId, onClose }: { workflowId: number; onClose: () => void }) {
  const frontendBase = "http://localhost:3000";
  const snippets = [
    {
      title: "工作流 JSON 嵌入",
      description: "导出 workflow.json，在你自己的项目中使用工作流运行器加载执行。",
      code: `const workflow = await fetch("./workflow.json").then(r => r.json());
const result = await runner.run(workflow, {
  input: "你的输入内容"
});`
    },
    {
      title: "接口调用嵌入",
      description: "通过后端运行当前工作流，适合内部工具或服务端集成。",
      code: `fetch("${API_BASE}/api/workflows/${workflowId}/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    inputs: {
      input: "你的输入内容"
    }
  })
});`
    },
    {
      title: "网页框架嵌入",
      description: "把轻量运行面板嵌到你的页面中。",
      code: `<iframe
  src="${frontendBase}${appPath(embedWorkflowPath(workflowId))}"
  width="100%"
  height="720"
  frameborder="0">
</iframe>`
    }
  ];
  return (
    <Modal title="嵌入工作流" description="提供工作流 JSON、接口调用和网页框架三种集成方式。" onClose={onClose}>
      <div className="grid max-h-[68vh] gap-3 overflow-auto">
        {snippets.map((snippet) => (
          <section key={snippet.title} className="rounded-tool border border-line bg-white p-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{snippet.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{snippet.description}</p>
              </div>
              <button className="btn" onClick={() => navigator.clipboard?.writeText(snippet.code)}>
                <Copy size={14} />
                复制
              </button>
            </div>
            <pre className="json-block max-h-56">{snippet.code}</pre>
          </section>
        ))}
      </div>
    </Modal>
  );
}

function Modal({ title, description, children, onClose }: { title: string; description: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6">
      <div className="w-full max-w-3xl rounded-tool border border-line bg-white shadow-panel">
        <div className="flex items-start justify-between gap-4 border-b border-line p-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <button className="btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
