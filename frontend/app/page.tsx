"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Boxes, LogOut, Plus, Trash2, UserPlus } from "lucide-react";
import { api, setAuthToken } from "@/lib/api";
import type { Project, User } from "@/types/workflow";

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [health, setHealth] = useState("checking");
  const [name, setName] = useState("通用 AI 工作流项目");
  const [description, setDescription] = useState("搭建论文、PPT、数据分析、代码审查、知识库问答或自动化办公流程");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "", display_name: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadCurrentUser() {
    setError("");
    try {
      const healthResult = await api.health();
      setHealth(healthResult.status);
      const currentUser = await api.me();
      setUser(currentUser);
      setProjects(await api.projects());
    } catch (exc) {
      setUser(null);
      setProjects([]);
      setHealth((exc instanceof Error && exc.message.includes("/health")) ? "error" : "ok");
    }
  }

  async function loadProjects() {
    setProjects(await api.projects());
  }

  useEffect(() => {
    loadCurrentUser();
  }, []);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result =
        authMode === "register"
          ? await api.register(authForm)
          : await api.login({ username: authForm.username, password: authForm.password });
      setAuthToken(result.token);
      setUser(result.user);
      setProjects(await api.projects());
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {}
    setAuthToken("");
    setUser(null);
    setProjects([]);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await api.createProject({ name, description });
      setName("");
      setDescription("");
      await loadProjects();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject(id: number) {
    if (!confirm("确认删除该项目以及它的 API、文件、工作流和运行记录？")) return;
    await api.deleteProject(id);
    await loadProjects();
  }

  if (!user) {
    return (
      <main className="min-h-screen px-6 py-10">
        <section className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.1fr_420px]">
          <div className="flex flex-col justify-center">
            <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs text-slate-600">
              <Boxes size={14} />
              通用 AI 工作流平台
            </div>
            <h1 className="text-3xl font-semibold tracking-normal text-ink">AI Workflow Builder</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
              注册后你的项目、API 配置、上传文件、工作流和运行记录都会保存到后端数据库，并且只在你的账号下显示。
            </p>
            <div className="mt-5 flex items-center gap-2 text-sm text-slate-600">
              <Activity size={16} />
              后端状态：<span className={health === "ok" ? "text-emerald-700" : "text-red-600"}>{health}</span>
            </div>
          </div>

          <form onSubmit={submitAuth} className="panel p-5">
            <div className="mb-4 flex rounded-tool border border-line bg-slate-50 p-1">
              <button type="button" className={`btn flex-1 ${authMode === "login" ? "btn-primary" : ""}`} onClick={() => setAuthMode("login")}>
                登录
              </button>
              <button type="button" className={`btn flex-1 ${authMode === "register" ? "btn-primary" : ""}`} onClick={() => setAuthMode("register")}>
                注册
              </button>
            </div>
            <div className="grid gap-3">
              <div className="field">
                <label>账号</label>
                <input className="input" value={authForm.username} onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })} required />
              </div>
              {authMode === "register" && (
                <div className="field">
                  <label>显示名称</label>
                  <input className="input" value={authForm.display_name} onChange={(event) => setAuthForm({ ...authForm, display_name: event.target.value })} />
                </div>
              )}
              <div className="field">
                <label>密码</label>
                <input className="input" type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} required />
              </div>
              {error && <div className="rounded-tool border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
              <button className="btn btn-primary w-full" disabled={loading}>
                <UserPlus size={16} />
                {authMode === "register" ? "注册并进入" : "登录"}
              </button>
              <p className="text-xs leading-5 text-slate-500">MVP 登录不含验证码。密码会以哈希形式保存，不会明文保存。</p>
            </div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-6">
      <section className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs text-slate-600">
              <Boxes size={14} />
              {user.display_name || user.username}
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-ink">AI Workflow Builder</h1>
            <p className="mt-1 text-sm text-slate-600">你的项目数据会保存到后端，并按账号隔离。</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-tool border border-line bg-white px-3 py-2 text-sm">
              <Activity size={16} />
              后端状态：<span className={health === "ok" ? "text-emerald-700" : "text-red-600"}>{health}</span>
            </div>
            <button className="btn" onClick={logout}>
              <LogOut size={16} />
              退出
            </button>
          </div>
        </header>

        {error && <div className="panel border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <form onSubmit={createProject} className="panel grid gap-3 p-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
          <div className="field">
            <label>项目名称</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="field">
            <label>描述</label>
            <input className="input" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={loading}>
            <Plus size={16} />
            新建项目
          </button>
        </form>

        <section className="grid gap-3 md:grid-cols-2">
          {projects.map((project) => (
            <article key={project.id} className="panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{project.name}</h2>
                  <p className="mt-1 min-h-10 text-sm text-slate-600">{project.description || "无描述"}</p>
                </div>
                <button className="btn btn-danger" onClick={() => deleteProject(project.id)} title="删除项目">
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>更新：{new Date(project.updated_at).toLocaleString()}</span>
                <Link className="btn btn-primary" href={`/projects/${project.id}`}>
                  进入项目
                </Link>
              </div>
            </article>
          ))}
          {!projects.length && <div className="panel p-6 text-sm text-slate-600">还没有项目。创建项目后即可配置 API、上传资料并搭建工作流。</div>}
        </section>
      </section>
    </main>
  );
}
