"use client";

import { useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  BadgeCheck,
  Bot,
  Brain,
  Braces,
  CheckCircle2,
  CheckSquare,
  Circle,
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
  Link as LinkIcon,
  ListChecks,
  MessageCircle,
  Loader2,
  Merge,
  Network,
  Presentation,
  RotateCcw,
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
  UserCheck,
  XCircle,
  type LucideIcon
} from "lucide-react";
import { fullPrompt, nodeCategory, nodeColor, nodeIcon, nodeLabel, promptPreview } from "@/lib/workflow";
import { API_BASE } from "@/lib/api";
import type { ApiProvider, NodeRunStatus } from "@/types/workflow";

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

const statusMeta: Record<NodeRunStatus, { label: string; className: string }> = {
  pending: { label: "未运行", className: "border-slate-200 bg-slate-50 text-slate-500" },
  running: { label: "运行中", className: "border-blue-200 bg-blue-50 text-blue-700" },
  success: { label: "成功", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  error: { label: "失败", className: "border-red-200 bg-red-50 text-red-700" },
  skipped: { label: "跳过", className: "border-amber-200 bg-amber-50 text-amber-700" },
  stopped: { label: "已停止", className: "border-slate-300 bg-slate-100 text-slate-600" }
};

type WorkflowNodeData = {
  label?: string;
  icon?: string;
  node_type?: string;
  description?: string;
  status?: NodeRunStatus;
  config?: Record<string, unknown>;
  connectMode?: boolean;
  connectSourceId?: string | null;
  providers?: ApiProvider[];
  lastRunOutput?: unknown;
  lastRunError?: string;
  isBusy?: boolean;
  onInlineConfigChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  onRerunNode?: (nodeId: string) => void;
};

export function CustomWorkflowNode({ id, data, selected }: NodeProps) {
  const [outputOpen, setOutputOpen] = useState(false);
  const typedData = data as WorkflowNodeData;
  const nodeType = typedData.node_type || "llm_call";
  const config = typedData.config || {};
  const providers = typedData.providers || [];
  const isApiNode = nodeType === "api_call" || nodeType === "llm_call";
  const isSkillNode = nodeType === "skill" || nodeType === "skill_workflow";
  const isBusy = Boolean(typedData.isBusy);
  const color = nodeColor(nodeType);
  const Icon = iconMap[typedData.icon || nodeIcon(nodeType)] || Bot;
  const status = typedData.status || "pending";
  const meta = statusMeta[status];
  const prompt = nodeType === "start" ? startSummary(config) : promptPreview(config);
  const contentLabel = nodeType === "skill" || nodeType === "skill_workflow" ? "技能" : nodeType === "cross_review" ? "评审" : nodeType === "chat" ? "对话" : "提示词";
  const isConnectSource = typedData.connectSourceId === id;
  const showExtraTargets = nodeType === "merge" || nodeType === "cross_review" || nodeType === "consensus_merge";
  const outputPreview = useMemo(() => buildOutputPreview(typedData.lastRunOutput), [typedData.lastRunOutput]);
  const hasOutputPreview = Boolean(typedData.lastRunOutput) || Boolean(typedData.lastRunError);
  const borderColor =
    status === "success" ? "#16a34a" : status === "error" ? "#dc2626" : status === "running" ? "#2563eb" : selected || isConnectSource ? "#1d4ed8" : "#d8dee8";

  return (
    <div
      className={`group ${isApiNode || isSkillNode ? "w-[320px]" : "w-[240px]"} rounded-lg border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-panel ${selected || isConnectSource ? "ring-2 ring-blue-100" : ""}`}
      style={{ borderColor }}
      title={fullPrompt(config)}
    >
      <Handle
        id="target"
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400 opacity-40 transition-opacity group-hover:opacity-100"
      />
      {showExtraTargets && (
        <>
          <Handle id="target-top" type="target" position={Position.Left} style={{ top: 34 }} className="!h-3 !w-3 !border-2 !border-white !bg-slate-400 opacity-40 group-hover:opacity-100" />
          <Handle id="target-bottom" type="target" position={Position.Left} style={{ top: 96 }} className="!h-3 !w-3 !border-2 !border-white !bg-slate-400 opacity-40 group-hover:opacity-100" />
        </>
      )}
      <Handle
        id="source"
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-blue-500 opacity-60 transition-opacity group-hover:opacity-100"
      />

      <div className="flex items-center justify-between gap-2 rounded-t-lg border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white" style={{ background: color }}>
            <Icon size={16} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{String(typedData.label || nodeLabel(nodeType))}</div>
            <div className="truncate text-[11px] text-slate-500">{nodeType}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            title="重新运行该节点"
            disabled={isBusy}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              typedData.onRerunNode?.(id);
            }}
          >
            <RotateCcw size={13} />
          </button>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${meta.className}`}>
            {status === "running" ? <Loader2 size={11} className="animate-spin" /> : status === "success" ? <CheckCircle2 size={11} /> : status === "error" ? <XCircle size={11} /> : <Circle size={10} />}
            {meta.label}
          </span>
        </div>
      </div>

      {isApiNode ? (
        <ApiInlineConfig nodeId={id} config={config} providers={providers} onChange={typedData.onInlineConfigChange} />
      ) : isSkillNode ? (
        <SkillInlineConfig nodeId={id} config={config} providers={providers} onChange={typedData.onInlineConfigChange} />
      ) : (
        <div className="space-y-1.5 px-3 py-2.5 text-xs text-slate-600">
          <div className="truncate">
            <span className="text-slate-400">类型：</span>
            {categoryLabel(nodeType)}
          </div>
          <div className="truncate">
            <span className="text-slate-400">智能体：</span>
            {providerSummary(nodeType, config, providers)}
          </div>
          <div className="line-clamp-2 leading-5">
            <span className="text-slate-400">{contentLabel}：</span>
            {prompt}
          </div>
        </div>
      )}

      {isSkillNode && (
        <div className="border-t border-slate-100 bg-white">
          <button
            type="button"
            className="nodrag nopan flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setOutputOpen((value) => !value);
            }}
            title={outputOpen ? "折叠输出" : "展开输出"}
          >
            <span className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded border border-slate-200 bg-slate-50 text-sm leading-none text-slate-700">
                {outputOpen ? "-" : "+"}
              </span>
              输出
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${hasOutputPreview ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-400"}`}>
              {hasOutputPreview ? "有结果" : "运行后显示"}
            </span>
          </button>
          {outputOpen && (
            <div
              className="nodrag nopan max-h-72 overflow-auto border-t border-slate-100 px-3 py-2 text-xs"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {typedData.lastRunError ? <div className="mb-2 rounded-md border border-red-100 bg-red-50 px-2 py-1.5 text-red-700">{typedData.lastRunError}</div> : null}
              {outputPreview.images.length ? (
                <div className="mb-2 grid grid-cols-2 gap-2">
                  {outputPreview.images.slice(0, 4).map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="技能节点输出" className="h-24 w-full object-cover" />
                    </a>
                  ))}
                </div>
              ) : null}
              <pre className="max-h-44 whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2 text-[11px] leading-5 text-slate-700">
                {outputPreview.text || "暂无输出。运行工作流后，这里会显示该技能节点的结果。"}
              </pre>
              {outputPreview.links.length ? (
                <div className="mt-2 space-y-1">
                  {outputPreview.links.slice(0, 4).map((link) => (
                    <a key={link} href={link} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-blue-600 hover:underline">
                      {link}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      <div className="hidden items-center justify-between border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400 group-hover:flex">
        <span>输入</span>
        <span>拖拽或点击连线</span>
        <span>输出</span>
      </div>
    </div>
  );
}

function ApiInlineConfig({
  nodeId,
  config,
  providers,
  onChange
}: {
  nodeId: string;
  config: Record<string, unknown>;
  providers: ApiProvider[];
  onChange?: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const selectedProvider = providers.find((provider) => provider.id === Number(config.provider_id || 0)) || null;
  const promptTemplate = String(config.prompt_template || "");

  function stopCanvasEvent(event: React.SyntheticEvent) {
    event.stopPropagation();
  }

  return (
    <div className="space-y-2 px-3 py-3 text-xs text-slate-600">
      <div className="grid gap-1.5">
        <label className="font-medium text-slate-500">API / 模型</label>
        <select
          className="nodrag nopan w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={String(config.provider_id || "")}
          onPointerDown={stopCanvasEvent}
          onClick={stopCanvasEvent}
          onKeyDown={stopCanvasEvent}
          onChange={(event) => onChange?.(nodeId, { provider_id: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">选择已配置智能体</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} / {provider.model_name || provider.provider_type}
            </option>
          ))}
        </select>
        <div className="truncate text-[11px] text-slate-400">{selectedProvider ? selectedProvider.description || selectedProvider.provider_type : "未配置 API / 智能体"}</div>
      </div>

      <div className="grid gap-1.5">
        <label className="font-medium text-slate-500">提示词</label>
        <textarea
          className="nodrag nopan min-h-20 w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={promptTemplate}
          placeholder="输入这个 API 节点要执行的提示词，可使用 {{input}} 或 {{previous_output}}"
          onPointerDown={stopCanvasEvent}
          onClick={stopCanvasEvent}
          onDoubleClick={stopCanvasEvent}
          onKeyDown={stopCanvasEvent}
          onChange={(event) => onChange?.(nodeId, { prompt_template: event.target.value })}
        />
      </div>
    </div>
  );
}

function SkillInlineConfig({
  nodeId,
  config,
  providers,
  onChange
}: {
  nodeId: string;
  config: Record<string, unknown>;
  providers: ApiProvider[];
  onChange?: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const selectedProvider = providers.find((provider) => provider.id === Number(config.provider_id || 0)) || null;
  const markdownContent = String(config.markdown_content || "");

  function stopCanvasEvent(event: React.SyntheticEvent) {
    event.stopPropagation();
  }

  return (
    <div className="space-y-2 px-3 py-3 text-xs text-slate-600">
      <div className="grid gap-1.5">
        <label className="font-medium text-slate-500">技能使用的 API / 模型</label>
        <select
          className="nodrag nopan w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={String(config.provider_id || "")}
          onPointerDown={stopCanvasEvent}
          onClick={stopCanvasEvent}
          onKeyDown={stopCanvasEvent}
          onChange={(event) => onChange?.(nodeId, { provider_id: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">自动选择可用智能体</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} / {provider.model_name || provider.provider_type}
            </option>
          ))}
        </select>
        <div className="truncate text-[11px] text-slate-400">{selectedProvider ? selectedProvider.description || selectedProvider.provider_type : "未指定时使用项目第一个启用智能体"}</div>
      </div>

      <div className="grid gap-1.5">
        <label className="font-medium text-slate-500">技能专用提示词</label>
        <textarea
          className="nodrag nopan min-h-24 w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={markdownContent}
          placeholder="写这个技能节点自己的 Markdown 指令，可使用 {{input}} 或 {{previous_output}}"
          onPointerDown={stopCanvasEvent}
          onClick={stopCanvasEvent}
          onDoubleClick={stopCanvasEvent}
          onKeyDown={stopCanvasEvent}
          onChange={(event) => onChange?.(nodeId, { markdown_content: event.target.value })}
        />
      </div>
    </div>
  );
}

type OutputPreview = {
  text: string;
  images: string[];
  links: string[];
};

const imageUrlPattern = /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
const markdownImagePattern = /!\[[^\]]*]\(([^)\s]+)[^)]*\)/g;
const imagePathPattern = /[A-Za-z]:[\\/][^\n\r"'<>]+?\.(png|jpe?g|gif|webp|svg)|\/[^\n\r"'<>]+?\.(png|jpe?g|gif|webp|svg)/i;

function buildOutputPreview(output: unknown): OutputPreview {
  if (!output) return { text: "", images: [], links: [] };
  const strings = collectStrings(output);
  const text = preferredOutputText(output) || strings.find((value) => value.trim().length > 20) || safeStringify(output);
  const imageCandidates = [...extractMarkdownImages(text), ...strings.filter(isImageSource)];
  const pathLinks = strings.filter(isLocalImagePath).map(localImagePathToUrl).filter(Boolean) as string[];
  return {
    text: truncateText(text, 1200),
    images: uniqueStrings([...imageCandidates, ...pathLinks]).slice(0, 8),
    links: uniqueStrings([...strings.filter(isHttpUrl), ...pathLinks]).slice(0, 8)
  };
}

function preferredOutputText(value: unknown): string {
  const direct = firstStringByKeys(value, ["processed_markdown", "markdown_text", "content", "text", "summary", "final_summary"]);
  if (direct) return direct;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const nestedText = firstStringByKeys(nested, ["processed_markdown", "markdown_text", "content", "text", "summary", "final_summary"]);
      if (nestedText) return nestedText;
    }
  }
  return "";
}

function firstStringByKeys(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) return item;
  }
  return "";
}

function collectStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, seen));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const keyHint = /image|url|path|file/i.test(key) && typeof item === "string" ? [item] : [];
    return [...keyHint, ...collectStrings(item, seen)];
  });
}

function extractMarkdownImages(text: string): string[] {
  return Array.from(text.matchAll(markdownImagePattern)).map((match) => match[1]).filter(isRenderableImageSource);
}

function isImageSource(value: string) {
  return isRenderableImageSource(value) || isLocalImagePath(value);
}

function isRenderableImageSource(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("data:image/") || imageUrlPattern.test(trimmed);
}

function isLocalImagePath(value: string) {
  return imagePathPattern.test(value.trim());
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function localImagePathToUrl(value: string) {
  const normalized = value.trim().replace(/\\/g, "/");
  const marker = "/storage/projects/";
  const index = normalized.toLowerCase().indexOf(marker);
  if (index === -1) return "";
  return `${API_BASE}${normalized.slice(index)}`;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function providerSummary(nodeType: string, config: Record<string, unknown>, providers: ApiProvider[]) {
  if (nodeType === "start") return config.use_all_project_files === false ? "指定资料" : "全部项目资料";
  if (nodeType === "skill" || nodeType === "skill_workflow") return String(config.skill_name || "未配置技能");
  if (Array.isArray(config.provider_ids) && config.provider_ids.length) return `${config.provider_ids.length} 个智能体`;
  if (Array.isArray(config.reviewer_provider_ids) && config.reviewer_provider_ids.length) return `${config.reviewer_provider_ids.length} 个评审智能体`;
  if (config.provider_id) {
    const provider = providers.find((item) => item.id === Number(config.provider_id));
    if (provider) return provider.description ? `${provider.name}：${provider.description}` : provider.name;
    return `智能体 #${config.provider_id}`;
  }
  if (config.command) return String(config.command);
  if (config.file_id) return `文件 #${config.file_id}`;
  return "未配置";
}

function startSummary(config: Record<string, unknown>) {
  const count = Array.isArray(config.file_ids) ? config.file_ids.length : 0;
  const text = String(config.text || "").trim();
  if (config.use_all_project_files === false) return count ? `已选择 ${count} 个资料文件` : "未选择资料文件";
  if (text) return "全部项目资料 + 手动补充文本";
  return "全部项目资料";
}

function categoryLabel(type: string) {
  const labels: Record<string, string> = {
    core: "核心",
    input: "输入",
    ai: "AI",
    logic: "逻辑",
    data: "数据",
    tool: "工具",
    output: "输出",
    check: "检查"
  };
  const category = nodeCategory(type);
  return category ? labels[category] : nodeLabel(type);
}
