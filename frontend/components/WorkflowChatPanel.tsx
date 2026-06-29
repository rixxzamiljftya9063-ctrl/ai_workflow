"use client";

import { FormEvent, useMemo, useState } from "react";
import { Bot, MessageCircle, Send, X } from "lucide-react";
import type { Node } from "@xyflow/react";
import { api } from "@/lib/api";
import type { ApiProvider, ChatMessage } from "@/types/workflow";

type Props = {
  node: Node | null;
  providers: ApiProvider[];
  onConfigChange: (nodeId: string, patch: Record<string, unknown>) => void;
};

export function WorkflowChatPanel({ node, providers, onConfigChange }: Props) {
  const [open, setOpen] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const nodeType = String(node?.data?.node_type || "");
  const config = (node?.data?.config as Record<string, unknown>) || {};
  const canBindNode = nodeType === "chat" || nodeType === "api_call" || nodeType === "llm_call";
  const history = useMemo(() => normalizeHistory(config.chat_history), [config.chat_history]);
  const providerId = Number(config.provider_id || 0);
  const selectedProvider = providers.find((provider) => provider.id === providerId) || null;

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!node || !canBindNode || !message.trim()) return;
    setError("");
    const userMessage: ChatMessage = { role: "user", content: message.trim(), created_at: new Date().toISOString() };
    const nextHistory = [...history, userMessage];
    onConfigChange(node.id, { chat_history: nextHistory });
    setMessage("");
    setSending(true);
    try {
      const provider = selectedProvider || providers.find((item) => item.enabled);
      if (!provider) throw new Error("请先在项目页添加或启用 API / 智能体。");
      const result = await api.chatProvider(provider.id, {
        message: userMessage.content,
        history,
        system_prompt: String(config.system_prompt || config.prompt_template || "")
      });
      if (result.status !== "success") {
        throw new Error(result.error || "对话调用失败");
      }
      const assistantMessage: ChatMessage = { role: "assistant", content: result.content, created_at: new Date().toISOString() };
      onConfigChange(node.id, {
        provider_id: provider.id,
        chat_history: [...nextHistory, assistantMessage],
        last_chat_output: result.content
      });
    } catch (exc) {
      const text = exc instanceof Error ? exc.message : String(exc);
      setError(text);
      onConfigChange(node.id, {
        chat_history: [
          ...nextHistory,
          {
            role: "assistant",
            content: `对话失败：${text}`,
            created_at: new Date().toISOString()
          }
        ]
      });
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button className="absolute bottom-4 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white shadow-panel" onClick={() => setOpen(true)} title="打开对话窗口">
        <MessageCircle size={20} />
      </button>
    );
  }

  return (
    <div className="absolute bottom-4 right-4 z-20 flex h-[390px] w-[360px] flex-col rounded-tool border border-line bg-white shadow-panel">
      <div className="flex items-start justify-between gap-3 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessageCircle size={16} />
            对话窗口
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{node && canBindNode ? `绑定：${String(node.data?.label || node.id)}` : "选择一个对话窗口或 API 节点后开始"}</p>
        </div>
        <button className="btn h-8 px-2" onClick={() => setOpen(false)} title="收起">
          <X size={14} />
        </button>
      </div>

      <div className="border-b border-line p-2">
        <select
          className="input h-9 text-xs"
          disabled={!node || !canBindNode}
          value={String(providerId || "")}
          onChange={(event) => node && onConfigChange(node.id, { provider_id: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">自动选择可用 API / 智能体</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} / {provider.model_name || provider.provider_type}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 space-y-2 overflow-auto bg-slate-50 p-3 text-xs">
        {!node || !canBindNode ? (
          <div className="rounded-tool border border-dashed border-slate-300 bg-white p-3 text-slate-500">从左侧拖入“对话窗口”节点，或选中一个 API 调用节点，对话会直接绑定到该节点。</div>
        ) : history.length ? (
          history.map((item, index) => <ChatBubble key={`${item.created_at || index}-${index}`} message={item} />)
        ) : (
          <div className="rounded-tool border border-dashed border-slate-300 bg-white p-3 text-slate-500">
            这里的对话会保存在当前节点配置里。你可以先选择 API / 智能体，再输入问题。
          </div>
        )}
        {sending && (
          <div className="flex items-center gap-2 text-slate-500">
            <Bot size={14} />
            正在生成回复...
          </div>
        )}
        {error && <div className="rounded-tool border border-red-200 bg-red-50 p-2 text-red-700">{error}</div>}
      </div>

      <form className="border-t border-line p-2" onSubmit={sendMessage}>
        <div className="flex gap-2">
          <textarea
            className="input min-h-16 resize-none text-xs"
            disabled={!node || !canBindNode || sending}
            value={message}
            placeholder={String(config.chat_placeholder || "输入消息，直接和该节点绑定的 API / 智能体对话")}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button className="btn btn-primary h-16 px-3" disabled={!node || !canBindNode || sending || !message.trim()} title="发送">
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[86%] rounded-tool px-3 py-2 leading-5 ${isUser ? "bg-blue-600 text-white" : "border border-line bg-white text-slate-700"}`}>
        <div className="mb-1 text-[10px] opacity-70">{isUser ? "你" : "智能体"}</div>
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}

function normalizeHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChatMessage => {
      if (!item || typeof item !== "object") return false;
      const role = (item as ChatMessage).role;
      const content = (item as ChatMessage).content;
      return ["user", "assistant", "system"].includes(role) && typeof content === "string";
    })
    .map((item) => ({ role: item.role, content: item.content, created_at: item.created_at }));
}
