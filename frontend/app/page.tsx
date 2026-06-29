"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Boxes, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Project } from "@/types/workflow";

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [health, setHealth] = useState("checking");
  const [name, setName] = useState("通用 AI 工作流项目");
  const [description, setDescription] = useState("搭建论文、PPT、数据分析、代码审查、知识库问答或自动化办公流程");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setError("");
    try {
      const [healthResult, projectResult] = await Promise.all([api.health(), api.projects()]);
      setHealth(healthResult.status);
      setProjects(projectResult);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setHealth("error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await api.createProject({ name, description });
      setName("");
      setDescription("");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject(id: number) {
    if (!confirm("确认删除该项目及其 API / 智能体、文件、工作流和运行记录？")) return;
    await api.deleteProject(id);
    await load();
  }

  return (
    <main className="min-h-screen px-6 py-6">
      <section className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs text-slate-600">
              <Boxes size={14} />
              通用 AI 工作流平台
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-ink">AI Workflow Builder</h1>
            <p className="mt-1 text-sm text-slate-600">通用可视化 AI 工作流搭建器：ProcessOn 画布 + Dify 式节点编排 + 可嵌入 workflow.json 导出。</p>
          </div>
          <div className="flex items-center gap-2 rounded-tool border border-line bg-white px-3 py-2 text-sm">
            <Activity size={16} />
            后端状态：<span className={health === "ok" ? "text-emerald-700" : "text-red-600"}>{health}</span>
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
          {!projects.length && <div className="panel p-6 text-sm text-slate-600">还没有项目。创建项目后可以配置 API / 智能体、上传资源，并从模板库或空白画布开始搭建通用 AI 工作流。</div>}
        </section>
      </section>
    </main>
  );
}
