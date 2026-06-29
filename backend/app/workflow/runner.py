import json
import re
import shlex
import subprocess
import time
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.entities import ApiProvider, FileAsset, Workflow, WorkflowRun, WorkflowRunStep
from app.services.provider_client import ProviderClient
from app.services.security import safe_child_path, sanitize_payload
from app.services.storage import outputs_dir, workspace_dir
from app.workflow.control import clear_run_stop, clear_workflow_stop, is_stop_requested


CROSS_REVIEW_DEFAULT = {
    "agreement_points": [],
    "conflict_points": [],
    "missing_constraints": [],
    "logic_errors": [],
    "risk_level": "medium",
    "recommended_action": "human_review",
    "revision_instructions": [],
    "final_summary": "",
    "raw_reviews": [],
    "agreement": [],
    "conflict": [],
    "missing": [],
    "logic_error": [],
    "risk": {"risk_level": "medium"},
    "revision_tasks": [],
    "routed_outputs": {},
    "source_coverage_issues": [],
    "unsupported_claims": [],
    "recommended_retrieval_queries": [],
    "nodes_to_rerun": [],
}

DANGEROUS_PATTERNS = [
    r"\brm\b",
    r"\bdel\b",
    r"\brmdir\b",
    r"\bformat\b",
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bpowershell\b",
    r"\bcmd\b",
    r"\.\.",
    r"[/\\]Windows[/\\]",
    r"[/\\]System32[/\\]",
    r"&&",
    r"\|\|",
    r";",
    r">",
    r"<",
]


class WorkflowExecutionError(Exception):
    def __init__(self, message: str, output_json: dict[str, Any] | None = None):
        super().__init__(message)
        self.output_json = output_json


class WorkflowRunner:
    def __init__(self, db: Session):
        self.db = db
        self.settings = get_settings()
        self.provider_client = ProviderClient(timeout_seconds=self.settings.request_timeout_seconds)

    def create_run_record(self, workflow: Workflow) -> WorkflowRun:
        clear_workflow_stop(workflow.id)
        run = WorkflowRun(
            project_id=workflow.project_id,
            workflow_id=workflow.id,
            status="running",
            started_at=datetime.utcnow(),
            final_output={},
        )
        self.db.add(run)
        self.db.commit()
        self.db.refresh(run)
        clear_run_stop(run.id)
        return run

    def _begin_live_step(
        self,
        workflow_state: dict[str, Any],
        step: WorkflowRunStep,
        node: dict[str, Any],
        current_step: int,
        total_steps: int,
        mode: str = "sequential",
    ) -> None:
        workflow_state["current_step"] = {
            "run_step_id": step.id,
            "node_id": step.node_id,
            "node_name": node.get("name") or step.node_id,
            "node_type": node.get("type") or step.node_type,
            "mode": mode,
            "current_step": current_step,
            "total_steps": total_steps,
            "started_at": datetime.utcnow().isoformat(),
        }
        step.output_json = sanitize_payload(
            {
                "status": "running",
                "live": True,
                "message": "节点已开始执行，正在等待输出。",
                "node_id": step.node_id,
                "node_type": step.node_type,
                "current_step": current_step,
                "total_steps": total_steps,
                "updated_at": datetime.utcnow().isoformat(),
            }
        )
        self.db.add(step)
        self.db.commit()

    def _clear_live_step(self, workflow_state: dict[str, Any]) -> None:
        workflow_state.pop("current_step", None)

    def _patch_live_step_output(self, workflow_state: dict[str, Any] | None, patch: dict[str, Any]) -> None:
        current_step = workflow_state.get("current_step") if isinstance(workflow_state, dict) else None
        if not isinstance(current_step, dict) or not current_step.get("run_step_id"):
            return
        step = self.db.get(WorkflowRunStep, int(current_step["run_step_id"]))
        if not step or step.status != "running":
            return
        existing = step.output_json if isinstance(step.output_json, dict) else {}
        next_output = {
            **existing,
            **patch,
            "status": "running",
            "live": True,
            "node_id": step.node_id,
            "node_type": step.node_type,
            "updated_at": datetime.utcnow().isoformat(),
        }
        step.output_json = sanitize_payload(next_output)
        self.db.add(step)
        self.db.commit()

    def _publish_live_api_calls(
        self,
        workflow_state: dict[str, Any] | None,
        strategy: dict[str, Any],
        api_calls: list[dict[str, Any]],
        message: str,
        live_call: dict[str, Any] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        calls = [*api_calls]
        if live_call:
            calls.append(live_call)
        patch = {
            **strategy_trace(strategy, calls),
            "provider_attempt_count": provider_attempt_count_from_calls(calls),
            "message": message,
        }
        if extra:
            patch.update(extra)
        self._patch_live_step_output(workflow_state, patch)

    async def execute_run_record(self, workflow: Workflow, run: WorkflowRun) -> WorkflowRun:
        node_outputs: dict[str, dict[str, Any]] = {}
        execution_plan: list[dict[str, Any]] = []
        error_nodes: list[dict[str, Any]] = []
        workflow_state = create_workflow_state(run.id)
        try:
            workflow_json = normalize_workflow_json(workflow.workflow_json)
            nodes = workflow_json["nodes"]
            edges = workflow_json["edges"]
            apply_workflow_limits(workflow_state, workflow_json)
            by_id = {node["id"]: node for node in nodes}
            order = workflow_execution_order(nodes, edges)
            execution_plan = build_execution_plan(order, by_id)

            for index, node_id in enumerate(order):
                if is_stop_requested(workflow.id, run.id):
                    self._mark_run_stopped(run, {"status": "stopped", "execution_plan": execution_plan, "node_outputs": node_outputs, "workflow_state": workflow_state, "materials": workflow_state["materials"], "api_call_summary": workflow_api_call_summary(workflow_state)})
                    return run
                node = by_id[node_id]
                upstream = collect_upstream(node_id, edges, node_outputs, workflow_state)
                context_package = build_node_context(str(run.id), node, upstream, workflow_state)
                prompt_context = build_prompt_context(node, upstream, context_package)
                step_input = build_step_input(index, order, execution_plan, node, upstream, prompt_context, context_package)
                step = WorkflowRunStep(
                    run_id=run.id,
                    node_id=node_id,
                    node_type=node.get("type", ""),
                    status="running",
                    input_json=sanitize_payload(step_input),
                    started_at=datetime.utcnow(),
                )
                self.db.add(step)
                self.db.commit()
                self.db.refresh(step)
                started = time.perf_counter()
                self._begin_live_step(workflow_state, step, node, index + 1, len(order))
                retry_info: dict[str, Any] = {}
                try:
                    output = await self.execute_node(workflow.project_id, node, upstream, context_package, workflow_state)
                    if runtime_node_type(str(node.get("type")), node.get("config") or {}) == "start":
                        workflow_state["materials"] = material_store_from_start_output(str(run.id), output)
                    workflow_state["artifacts"][node_id] = artifact_record_from_output(node, output, context_package)
                    step.status = "success"
                    step.output_json = sanitize_payload(output)
                    node_outputs[node_id] = output
                    workflow_state["node_outputs"][node_id] = sanitize_payload(output)
                except Exception as exc:
                    step.status = "error"
                    step.error_message = str(exc)
                    error_output = exc.output_json if isinstance(exc, WorkflowExecutionError) and exc.output_json else {"error": str(exc)}
                    step.output_json = sanitize_payload(error_output)
                    node_outputs[node_id] = error_output
                    workflow_state["node_outputs"][node_id] = sanitize_payload(error_output)
                    error_nodes.append({"node_id": node_id, "node_name": node.get("name") or node_id, "node_type": node.get("type"), "error_message": str(exc)})
                    if not is_recoverable_node_error(exc):
                        raise
                finally:
                    step.finished_at = datetime.utcnow()
                    step.duration_ms = int((time.perf_counter() - started) * 1000)
                    self.db.add(step)
                    self.db.commit()
                    self._clear_live_step(workflow_state)

            run.status = "failed" if error_nodes else "success"
            run.final_output = sanitize_payload({"status": run.status, "error_nodes": error_nodes, "execution_plan": execution_plan, "node_outputs": node_outputs, "last_output": last_output(order, node_outputs), "workflow_state": workflow_state, "materials": workflow_state["materials"], "api_call_summary": workflow_api_call_summary(workflow_state)})
        except Exception as exc:
            run.status = "failed"
            run.final_output = sanitize_payload({"error": str(exc), "error_nodes": error_nodes, "execution_plan": execution_plan, "node_outputs": node_outputs, "workflow_state": workflow_state, "materials": workflow_state["materials"], "api_call_summary": workflow_api_call_summary(workflow_state)})
        finally:
            run.finished_at = datetime.utcnow()
            self.db.add(run)
            self.db.commit()
            self.db.refresh(run)
            clear_run_stop(run.id)
        return run

    async def run(self, workflow: Workflow) -> WorkflowRun:
        return await self.execute_run_record(workflow, self.create_run_record(workflow))

    async def run_node(self, workflow: Workflow, target_node_id: str) -> WorkflowRun:
        return await self.execute_node_run_record(workflow, self.create_run_record(workflow), target_node_id)

    async def execute_node_run_record(self, workflow: Workflow, run: WorkflowRun, target_node_id: str) -> WorkflowRun:
        node_outputs: dict[str, dict[str, Any]] = {}
        execution_plan: list[dict[str, Any]] = []
        error_nodes: list[dict[str, Any]] = []
        workflow_state = create_workflow_state(run.id)
        try:
            workflow_json = normalize_workflow_json(workflow.workflow_json)
            nodes = workflow_json["nodes"]
            edges = workflow_json["edges"]
            apply_workflow_limits(workflow_state, workflow_json)
            by_id = {node["id"]: node for node in nodes}
            if target_node_id not in by_id:
                raise WorkflowExecutionError(f"Node not found: {target_node_id}")
            order = workflow_execution_order(nodes, edges)
            if target_node_id not in order:
                raise WorkflowExecutionError(f"Node is not reachable from start: {target_node_id}")
            dependencies = upstream_dependencies(target_node_id, edges)
            execution_plan = build_execution_plan(order, by_id)

            for dependency_index, node_id in enumerate(order):
                if node_id == target_node_id:
                    break
                if node_id in dependencies:
                    if is_stop_requested(workflow.id, run.id):
                        self._mark_run_stopped(run, {"status": "stopped", "target_node_id": target_node_id, "execution_plan": execution_plan, "node_outputs": node_outputs, "workflow_state": workflow_state, "materials": workflow_state["materials"], "api_call_summary": workflow_api_call_summary(workflow_state)})
                        return run
                    dependency_node = by_id[node_id]
                    upstream = collect_upstream(node_id, edges, node_outputs, workflow_state)
                    context_package = build_node_context(str(run.id), dependency_node, upstream, workflow_state)
                    prompt_context = build_prompt_context(dependency_node, upstream, context_package)
                    step_input = build_step_input(dependency_index, order, execution_plan, dependency_node, upstream, prompt_context, context_package)
                    if isinstance(step_input.get("execution"), dict):
                        step_input["execution"]["mode"] = "single_node_rerun_dependency"
                        step_input["execution"]["target_node_id"] = target_node_id
                    step = WorkflowRunStep(
                        run_id=run.id,
                        node_id=node_id,
                        node_type=dependency_node.get("type", ""),
                        status="running",
                        input_json=sanitize_payload(step_input),
                        started_at=datetime.utcnow(),
                    )
                    self.db.add(step)
                    self.db.commit()
                    self.db.refresh(step)
                    started = time.perf_counter()
                    self._begin_live_step(workflow_state, step, dependency_node, dependency_index + 1, len(order), "single_node_rerun_dependency")
                    try:
                        output = await self.execute_node(workflow.project_id, dependency_node, upstream, context_package, workflow_state)
                        if runtime_node_type(str(dependency_node.get("type")), dependency_node.get("config") or {}) == "start":
                            workflow_state["materials"] = material_store_from_start_output(str(run.id), output)
                        step.status = "success"
                        step.output_json = sanitize_payload(output)
                        node_outputs[node_id] = output
                        workflow_state["node_outputs"][node_id] = sanitize_payload(output)
                        workflow_state["artifacts"][node_id] = artifact_record_from_output(dependency_node, output, context_package)
                    except Exception as exc:
                        step.status = "error"
                        step.error_message = str(exc)
                        output = exc.output_json if isinstance(exc, WorkflowExecutionError) and exc.output_json else {"error": str(exc)}
                        step.output_json = sanitize_payload(output)
                        node_outputs[node_id] = output
                        workflow_state["node_outputs"][node_id] = sanitize_payload(output)
                        error_nodes.append({"node_id": node_id, "node_name": dependency_node.get("name") or node_id, "node_type": dependency_node.get("type"), "error_message": str(exc)})
                        if not is_recoverable_node_error(exc):
                            raise
                    finally:
                        step.finished_at = datetime.utcnow()
                        step.duration_ms = int((time.perf_counter() - started) * 1000)
                        self.db.add(step)
                        self.db.commit()
                        self._clear_live_step(workflow_state)

            if is_stop_requested(workflow.id, run.id):
                self._mark_run_stopped(run, {"status": "stopped", "target_node_id": target_node_id, "execution_plan": execution_plan, "node_outputs": node_outputs, "workflow_state": workflow_state, "materials": workflow_state["materials"], "api_call_summary": workflow_api_call_summary(workflow_state)})
                return run

            target_node = by_id[target_node_id]
            upstream = collect_upstream(target_node_id, edges, node_outputs, workflow_state)
            context_package = build_node_context(str(run.id), target_node, upstream, workflow_state)
            prompt_context = build_prompt_context(target_node, upstream, context_package)
            target_index = order.index(target_node_id)
            step = WorkflowRunStep(
                run_id=run.id,
                node_id=target_node_id,
                node_type=target_node.get("type", ""),
                status="running",
                input_json=sanitize_payload(
                    {
                            "execution": {
                                "mode": "single_node_rerun",
                                "current_step": target_index + 1,
                                "total_steps": len(order),
                                "target_node_id": target_node_id,
                                "execution_plan": execution_plan,
                                "transfer_rule": "单节点重跑会先按箭头顺序重算它的上游依赖，再只记录并更新当前节点；不做并发执行。",
                            },
                        "prompt": prompt_context,
                        "node": target_node,
                        "upstream": upstream,
                        "context_package": context_package,
                        "retrieved_material_chunks": context_package.get("retrieved_material_chunks", []),
                        "source_refs": context_package.get("source_refs", []),
                        "missing_information": context_package.get("missing_context", []),
                        "retry_info": {},
                    }
                ),
                started_at=datetime.utcnow(),
            )
            self.db.add(step)
            self.db.commit()
            self.db.refresh(step)
            started = time.perf_counter()
            self._begin_live_step(workflow_state, step, target_node, target_index + 1, len(order), "single_node_rerun")
            retry_info: dict[str, Any] = {}
            try:
                output = await self.execute_node(workflow.project_id, target_node, upstream, context_package, workflow_state)
                if runtime_node_type(str(target_node.get("type")), target_node.get("config") or {}) == "start":
                    workflow_state["materials"] = material_store_from_start_output(str(run.id), output)
                step.status = "success"
                step.output_json = sanitize_payload(output)
                node_outputs[target_node_id] = output
                workflow_state["node_outputs"][target_node_id] = sanitize_payload(output)
                workflow_state["artifacts"][target_node_id] = artifact_record_from_output(target_node, output, context_package)
            except Exception as exc:
                step.status = "error"
                step.error_message = str(exc)
                error_output = exc.output_json if isinstance(exc, WorkflowExecutionError) and exc.output_json else {"error": str(exc)}
                step.output_json = sanitize_payload(error_output)
                node_outputs[target_node_id] = error_output
                workflow_state["node_outputs"][target_node_id] = sanitize_payload(error_output)
                error_nodes.append({"node_id": target_node_id, "node_name": target_node.get("name") or target_node_id, "node_type": target_node.get("type"), "error_message": str(exc)})
                if not is_recoverable_node_error(exc):
                    raise
            finally:
                step.finished_at = datetime.utcnow()
                step.duration_ms = int((time.perf_counter() - started) * 1000)
                self.db.add(step)
                self.db.commit()
                self._clear_live_step(workflow_state)

            run.status = "failed" if error_nodes else "success"
            run.final_output = sanitize_payload({"status": run.status, "error_nodes": error_nodes, "mode": "single_node_rerun", "target_node_id": target_node_id, "execution_plan": execution_plan, "node_outputs": node_outputs, "last_output": node_outputs.get(target_node_id, {}), "workflow_state": workflow_state, "materials": workflow_state["materials"], "api_call_summary": workflow_api_call_summary(workflow_state)})
        except Exception as exc:
            run.status = "failed"
            run.final_output = sanitize_payload({"error": str(exc), "error_nodes": error_nodes, "mode": "single_node_rerun", "target_node_id": target_node_id, "execution_plan": execution_plan, "node_outputs": node_outputs, "workflow_state": workflow_state, "materials": workflow_state["materials"], "api_call_summary": workflow_api_call_summary(workflow_state)})
        finally:
            run.finished_at = datetime.utcnow()
            self.db.add(run)
            self.db.commit()
            self.db.refresh(run)
            clear_run_stop(run.id)
        return run

    def _mark_run_stopped(self, run: WorkflowRun, final_output: dict[str, Any]) -> None:
        run.status = "stopped"
        run.final_output = sanitize_payload(final_output)
        run.finished_at = datetime.utcnow()
        self.db.add(run)
        self.db.commit()
        self.db.refresh(run)

    async def execute_node(
        self,
        project_id: int,
        node: dict[str, Any],
        upstream: dict[str, Any],
        context_package: dict[str, Any] | None = None,
        workflow_state: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        node_type = node.get("type")
        config = node.get("config") or {}
        node_type = runtime_node_type(str(node_type), config)
        workflow_state = workflow_state or create_workflow_state("")
        context_package = context_package or build_node_context("", node, upstream, workflow_state)
        if node_type == "start":
            return self._start_node(project_id, config)
        if node_type in {"end", "manual", "human_review", "note", "group"}:
            return {
                config.get("output_key") or node_type: config.get("text") or config.get("node_instruction") or node.get("name") or node_type,
                "content": config.get("text") or config.get("node_instruction") or "",
            }
        if node_type == "text_input":
            key = config.get("output_key") or "text"
            return {key: config.get("text", ""), "content": config.get("text", "")}
        if node_type == "file_input":
            file_id = config.get("file_id")
            if not file_id:
                raise WorkflowExecutionError("file_input requires file_id")
            asset = self.db.get(FileAsset, int(file_id))
            if not asset or asset.project_id != project_id:
                raise WorkflowExecutionError("Selected file not found in project")
            key = config.get("output_key") or "file_text"
            return {key: asset.extracted_text, "file_id": asset.id, "filename": asset.original_name, "content": asset.extracted_text}
        if node_type in {"form_input", "url_input", "variable_input"}:
            key = config.get("output_key") or "input"
            return {key: config, "content": json.dumps(config, ensure_ascii=False)}
        if node_type == "llm_call":
            return await self._execute_model_node_with_strategy(project_id, node, "api", config, upstream, context_package, workflow_state)
        if node_type == "chat":
            history = config.get("chat_history") or []
            last_assistant = ""
            if isinstance(history, list):
                for item in reversed(history):
                    if isinstance(item, dict) and item.get("role") == "assistant":
                        last_assistant = str(item.get("content") or "")
                        break
            key = config.get("output_key") or "chat_output"
            return {
                key: {
                    "messages": history,
                    "last_assistant_message": last_assistant,
                    "upstream": upstream,
                },
                "content": last_assistant,
                "provider_id": config.get("provider_id"),
            }
        if node_type == "skill":
            return await self._execute_model_node_with_strategy(project_id, node, "skill", config, upstream, context_package, workflow_state)
        if node_type == "parallel_llm":
            provider_ids = config.get("provider_ids") or []
            if not provider_ids:
                provider_ids = [provider.id for provider in self._project_providers(project_id)]
            prompt = render_template(config.get("prompt_template", ""), upstream, context_package)
            results = []
            for provider_id in provider_ids:
                results.append(await self._run_single_parallel(project_id, provider_id, prompt, str(config.get("system_prompt") or "")))
            return {"results": results, config.get("output_key") or "parallel_results": results}
        if node_type == "cross_review":
            return await self._cross_review(project_id, config, upstream, context_package)
        if node_type == "merge":
            strategy = config.get("merge_strategy") or "json"
            output = {"strategy": strategy, "merged": upstream}
            if strategy == "text":
                output["content"] = "\n\n".join(json.dumps(value, ensure_ascii=False) for value in upstream.values())
            return {config.get("output_key") or "merged": output, "content": output.get("content", json.dumps(output, ensure_ascii=False))}
        if node_type in {
            "data_parse",
            "json_transform",
            "table_process",
            "text_extract",
            "chunk_split",
            "embedding",
            "search",
            "web_request",
            "http_request",
            "database_query",
            "file_write",
            "ppt_output",
            "word_output",
        }:
            key = config.get("output_key") or "result"
            return {
                key: upstream,
                "content": json.dumps(upstream, ensure_ascii=False),
                "note": f"{node_type} is handled as a generic pass-through node in MVP.",
            }
        if node_type == "code_generation":
            return await self._code_generation(project_id, config, upstream, context_package)
        if node_type == "code_execution":
            return self._code_execution(project_id, config)
        if node_type == "result_validation":
            return self._result_validation(project_id, config, upstream)
        if node_type == "document_write":
            return await self._document_write(project_id, config, upstream, context_package)
        if node_type == "compliance_check":
            return await self._compliance_check(project_id, config, upstream)
        if node_type == "export":
            return self._export_node(project_id, config, upstream)
        if node_type == "condition":
            return {"passed": evaluate_condition(config, upstream), "condition": config}
        raise WorkflowExecutionError(f"Unsupported node type: {node_type}")

    async def _run_single_parallel(self, project_id: int, provider_id: int, prompt: str, system_prompt: str = "") -> dict[str, Any]:
        provider = self._provider(project_id, provider_id)
        result = await self.provider_client.complete(provider, prompt, system_prompt)
        return {
            "provider_id": provider.id,
            "provider_name": provider.name,
            "model_name": provider.model_name,
            "status": result.status,
            "content": result.content,
            "error": result.error,
        }

    async def _execute_model_node_with_strategy(
        self,
        project_id: int,
        node: dict[str, Any],
        model_kind: str,
        config: dict[str, Any],
        upstream: dict[str, Any],
        context_package: dict[str, Any],
        workflow_state: dict[str, Any],
    ) -> dict[str, Any]:
        strategy = normalize_execution_strategy(config, model_kind)
        strategy["workflow_state"] = workflow_state
        if strategy["execution_strategy"] == "retrieve_then_retry":
            return await self._strategy_retrieve_then_retry(project_id, node, model_kind, config, upstream, context_package, workflow_state, strategy)
        if strategy["execution_strategy"] == "draft_review_revise":
            return await self._strategy_draft_review_revise(project_id, node, model_kind, config, upstream, context_package, strategy)
        if strategy["execution_strategy"] == "multi_candidate_review":
            return await self._strategy_multi_candidate_review(project_id, node, model_kind, config, upstream, context_package, strategy)
        if strategy["execution_strategy"] == "map_reduce":
            return await self._strategy_map_reduce(project_id, node, model_kind, config, upstream, context_package, workflow_state, strategy)
        return await self._strategy_single_pass(project_id, node, model_kind, config, upstream, context_package, strategy)

    async def _strategy_single_pass(
        self,
        project_id: int,
        node: dict[str, Any],
        model_kind: str,
        config: dict[str, Any],
        upstream: dict[str, Any],
        context_package: dict[str, Any],
        strategy: dict[str, Any],
    ) -> dict[str, Any]:
        api_calls: list[dict[str, Any]] = []
        prompt = build_model_prompt(model_kind, config, upstream, context_package, "generate")
        provider = self._provider(project_id, config.get("provider_id"))
        call = await self._call_model(provider, prompt, str(config.get("system_prompt") or ""), "generate", api_calls, strategy)
        if call["status"] != "success":
            output = strategy_error_output(strategy, api_calls, call.get("error_message") or "模型调用失败")
            raise WorkflowExecutionError(call.get("error_message") or "Model call failed", output)
        return model_output_from_content(model_kind, config, provider, call["response"], upstream, context_package, strategy, api_calls)

    async def _strategy_retrieve_then_retry(
        self,
        project_id: int,
        node: dict[str, Any],
        model_kind: str,
        config: dict[str, Any],
        upstream: dict[str, Any],
        context_package: dict[str, Any],
        workflow_state: dict[str, Any],
        strategy: dict[str, Any],
    ) -> dict[str, Any]:
        strategy["max_api_calls"] = min(int(strategy.get("max_api_calls") or 2), 2)
        api_calls: list[dict[str, Any]] = []
        provider = self._provider(project_id, config.get("provider_id"))
        first_prompt = build_model_prompt(model_kind, config, upstream, context_package, "generate")
        first = await self._call_model(provider, first_prompt, str(config.get("system_prompt") or ""), "generate", api_calls, strategy)
        if first["status"] != "success":
            output = strategy_error_output(strategy, api_calls, first.get("error_message") or "模型调用失败")
            raise WorkflowExecutionError(first.get("error_message") or "Model call failed", output)
        first_output = model_output_from_content(model_kind, config, provider, first["response"], upstream, context_package, strategy, api_calls, attach_calls=False)
        retry_info = {
            "enabled": True,
            "retry_reason": "",
            "retrieval_queries": [],
            "additional_chunks": [],
            "retry_count": 0,
        }
        if not bool(first_output.get("need_more_context")):
            first_output.update(strategy_trace(strategy, api_calls, retry_info))
            return first_output

        retry_info = build_retry_info(first_output, workflow_state.get("materials") or {}, context_package)
        retry_info["enabled"] = True
        retry_info["retry_count"] = 0
        if not can_make_call(strategy, api_calls):
            first_output.setdefault("warnings", []).append("max_api_calls 已达到上限，无法补充上下文重试。")
            first_output.update(strategy_trace(strategy, api_calls, retry_info))
            return first_output

        retry_context = with_additional_chunks(context_package, retry_info.get("additional_chunks") or [])
        retry_info["retry_count"] = 1
        retry_prompt = (
            "这是补充上下文后的重试。请基于 additional_chunks 与完整上游输出生成最终结果；不要继续要求无限重试。\n\n"
            f"Retry info:\n{json.dumps(retry_info, ensure_ascii=False, indent=2)}\n\n"
            f"{build_model_prompt(model_kind, config, upstream, retry_context, 'retry')}"
        )
        second = await self._call_model(provider, retry_prompt, str(config.get("system_prompt") or ""), "retry", api_calls, strategy)
        if second["status"] != "success":
            first_output.setdefault("warnings", []).append(second.get("error_message") or "重试调用失败，已保留第一次输出。")
            first_output.update(strategy_trace(strategy, api_calls, retry_info))
            return first_output
        final_output = model_output_from_content(model_kind, config, provider, second["response"], upstream, retry_context, strategy, api_calls, attach_calls=False)
        if final_output.get("need_more_context"):
            final_output.setdefault("warnings", []).append("第二次调用仍提示资料不足，已按最大重试次数停止。")
        final_output["retry_info"] = retry_info
        final_output.update(strategy_trace(strategy, api_calls, retry_info))
        return final_output

    async def _strategy_draft_review_revise(
        self,
        project_id: int,
        node: dict[str, Any],
        model_kind: str,
        config: dict[str, Any],
        upstream: dict[str, Any],
        context_package: dict[str, Any],
        strategy: dict[str, Any],
    ) -> dict[str, Any]:
        strategy["max_api_calls"] = min(int(strategy.get("max_api_calls") or 3), 3)
        api_calls: list[dict[str, Any]] = []
        provider = self._provider(project_id, config.get("provider_id"))
        reviewer = self._provider(project_id, config.get("reviewer_provider_id") or config.get("provider_id"))
        draft_prompt = "请根据输入上下文完成当前节点任务，输出结构化 JSON。\n\n" + build_model_prompt(model_kind, config, upstream, context_package, "generate")
        draft_call = await self._call_model(provider, draft_prompt, str(config.get("system_prompt") or ""), "generate", api_calls, strategy)
        draft = parsed_or_text(draft_call.get("response") or "")
        if draft_call["status"] != "success" or not can_make_call(strategy, api_calls):
            output = compose_draft_review_output(config, draft, {}, draft, strategy, api_calls, provider)
            if draft_call["status"] != "success":
                output["warnings"] = [draft_call.get("error_message") or "draft 调用失败"]
                raise WorkflowExecutionError(output["warnings"][0], output)
            return output

        review_prompt = (
            "你是一个严格的质量审查器。请审查下面的 draft 是否存在逻辑不连贯、资料遗漏、无来源结论、JSON 结构不规范、"
            "内容不适合当前节点任务、与用户需求不一致、后续节点难以使用等问题。请输出 JSON："
            '{"is_acceptable": true, "problems": [], "revision_instructions": [], "risk_level": "low | medium | high"}'
            f"\n\nDraft:\n{json.dumps(draft, ensure_ascii=False, indent=2)}"
        )
        review_call = await self._call_model(reviewer, review_prompt, "", "review", api_calls, strategy)
        review = parsed_or_text(review_call.get("response") or "")
        acceptable = isinstance(review, dict) and bool(review.get("is_acceptable"))
        if review_call["status"] != "success" or acceptable or not can_make_call(strategy, api_calls):
            output = compose_draft_review_output(config, draft, review, draft, strategy, api_calls, provider)
            if review_call["status"] != "success":
                output.setdefault("warnings", []).append(review_call.get("error_message") or "review 调用失败，已使用 draft。")
            return output

        revise_prompt = (
            "请根据 review 结果修订 draft。要求保留正确内容，修复 review 指出的问题，不要编造资料，输出最终结构化 JSON。\n\n"
            f"Review:\n{json.dumps(review, ensure_ascii=False, indent=2)}\n\nDraft:\n{json.dumps(draft, ensure_ascii=False, indent=2)}"
        )
        revise_call = await self._call_model(provider, revise_prompt, str(config.get("system_prompt") or ""), "revise", api_calls, strategy)
        revised = parsed_or_text(revise_call.get("response") or "")
        if revise_call["status"] != "success":
            revised = draft
        return compose_draft_review_output(config, draft, review, revised, strategy, api_calls, provider)

    async def _strategy_multi_candidate_review(
        self,
        project_id: int,
        node: dict[str, Any],
        model_kind: str,
        config: dict[str, Any],
        upstream: dict[str, Any],
        context_package: dict[str, Any],
        strategy: dict[str, Any],
    ) -> dict[str, Any]:
        candidate_count = max(1, min(int(strategy.get("candidate_count") or 3), 5))
        strategy["candidate_count"] = candidate_count
        api_calls: list[dict[str, Any]] = []
        provider = self._provider(project_id, config.get("provider_id"))
        reviewer = self._provider(project_id, config.get("reviewer_provider_id") or config.get("provider_id"))
        candidates = []
        for index in range(candidate_count):
            if not can_make_call(strategy, api_calls):
                break
            prompt = f"请生成第 {index + 1} 个候选结果，要求与其他候选有差异但不编造事实。\n\n" + build_model_prompt(model_kind, config, upstream, context_package, "candidate")
            call = await self._call_model(provider, prompt, str(config.get("system_prompt") or ""), "candidate", api_calls, strategy)
            candidates.append({"candidate_index": index + 1, "status": call["status"], "result": parsed_or_text(call.get("response") or ""), "error_message": call.get("error_message") or ""})
        review = {}
        if can_make_call(strategy, api_calls):
            review_prompt = "请评审这些候选结果，指出优缺点并选择可合并方案，输出 JSON。\n\n" + json.dumps(candidates, ensure_ascii=False, indent=2)
            review_call = await self._call_model(reviewer, review_prompt, "", "review", api_calls, strategy)
            review = parsed_or_text(review_call.get("response") or "")
        final = review
        if can_make_call(strategy, api_calls):
            merge_prompt = "请基于候选结果和评审意见合并出最终结果，输出结构化 JSON。\n\n" + json.dumps({"candidates": candidates, "review": review}, ensure_ascii=False, indent=2)
            merge_call = await self._call_model(provider, merge_prompt, str(config.get("system_prompt") or ""), "merge", api_calls, strategy)
            final = parsed_or_text(merge_call.get("response") or "")
        content = content_from_value(final)
        return {
            "candidates": candidates,
            "review": review,
            "final": final,
            "content": content,
            **standard_model_output(content),
            **strategy_trace(strategy, api_calls),
        }

    async def _strategy_map_reduce(
        self,
        project_id: int,
        node: dict[str, Any],
        model_kind: str,
        config: dict[str, Any],
        upstream: dict[str, Any],
        context_package: dict[str, Any],
        workflow_state: dict[str, Any],
        strategy: dict[str, Any],
    ) -> dict[str, Any]:
        api_calls: list[dict[str, Any]] = []
        provider = self._provider(project_id, config.get("provider_id"))
        mr = strategy.get("map_reduce") or {}
        chunks = map_reduce_chunks(workflow_state, context_package, int(mr.get("max_chunks") or 10), int(mr.get("chunk_size") or 6000), int(mr.get("chunk_overlap") or 500))
        if not chunks:
            return {
                "map_results": [],
                "reduced_result": {},
                "content": "",
                "source_refs": [],
                "missing_information": ["没有可用于 map_reduce 的资料片段。"],
                "confidence": "low",
                **strategy_trace(strategy, api_calls),
            }
        map_results = []
        map_prompt_template = str(mr.get("map_prompt") or config.get("prompt_template") or "请从该资料片段提取与当前节点任务相关的信息，保留来源。")
        for chunk in chunks:
            if not can_make_call(strategy, api_calls, reserve=1):
                break
            prompt = (
                f"{map_prompt_template}\n\nChunk metadata:\n{json.dumps({k: chunk.get(k) for k in ['source_id', 'chunk_id', 'chunk_index']}, ensure_ascii=False)}"
                f"\n\nChunk content:\n{chunk.get('content') or ''}"
            )
            call = await self._call_model(provider, prompt, str(config.get("system_prompt") or ""), "map", api_calls, strategy)
            map_results.append({
                "source_id": chunk.get("source_id"),
                "chunk_id": chunk.get("chunk_id"),
                "status": call["status"],
                "result": parsed_or_text(call.get("response") or ""),
                "error_message": call.get("error_message") or "",
            })
        reduced = {}
        if can_make_call(strategy, api_calls):
            reduce_prompt = str(mr.get("reduce_prompt") or "请合并所有片段提取结果，去重、归类，并输出结构化 JSON。")
            reduce_call = await self._call_model(provider, reduce_prompt + "\n\n" + json.dumps(map_results, ensure_ascii=False, indent=2), str(config.get("system_prompt") or ""), "reduce", api_calls, strategy)
            reduced = parsed_or_text(reduce_call.get("response") or "")
        content = content_from_value(reduced)
        source_refs = [{"source_id": item.get("source_id"), "chunk_id": item.get("chunk_id")} for item in map_results]
        return {
            "map_results": map_results,
            "reduced_result": reduced,
            "content": content,
            "source_refs": source_refs,
            "missing_information": [],
            "confidence": "medium",
            **standard_model_output(content),
            **strategy_trace(strategy, api_calls),
        }

    async def _call_model(
        self,
        provider: ApiProvider,
        prompt: str,
        system_prompt: str,
        call_type: str,
        api_calls: list[dict[str, Any]],
        strategy: dict[str, Any],
    ) -> dict[str, Any]:
        if not can_make_call(strategy, api_calls):
            call = {
                "call_index": len(api_calls) + 1,
                "call_type": call_type,
                "provider_id": provider.id,
                "provider_name": provider.name,
                "prompt": prompt,
                "response": "",
                "parsed_response": {},
                "status": "error",
                "error_message": "max_api_calls 已达到上限",
                "skipped": True,
                "duration_ms": 0,
                "created_at": datetime.utcnow().isoformat(),
            }
            api_calls.append(call)
            workflow_state = strategy.get("workflow_state") if isinstance(strategy.get("workflow_state"), dict) else {}
            self._publish_live_api_calls(workflow_state, strategy, api_calls, "已达到当前节点 API 调用上限，本次调用跳过。")
            return call
        workflow_state = strategy.get("workflow_state") if isinstance(strategy.get("workflow_state"), dict) else {}
        if not can_make_workflow_call(workflow_state):
            limit = workflow_state.get("max_total_api_calls")
            message = f"max_total_api_calls 已达到上限（{limit}），本次调用已跳过。"
            workflow_state.setdefault("global_warnings", []).append(message)
            call = {
                "call_index": len(api_calls) + 1,
                "call_type": call_type,
                "provider_id": provider.id,
                "provider_name": provider.name,
                "prompt": prompt,
                "response": "",
                "parsed_response": {},
                "status": "error",
                "error_message": message,
                "skipped": True,
                "duration_ms": 0,
                "created_at": datetime.utcnow().isoformat(),
                "workflow_api_call_count": int(workflow_state.get("api_call_count") or 0),
                "max_total_api_calls": limit,
            }
            api_calls.append(call)
            self._publish_live_api_calls(workflow_state, strategy, api_calls, "已达到工作流总 API 调用上限，本次调用跳过。")
            return call
        max_attempts = provider_retry_max_attempts(provider, self.settings.provider_retry_max_attempts)
        attempts: list[dict[str, Any]] = []
        result = None
        total_started = time.perf_counter()
        call_index = len(api_calls) + 1
        self._publish_live_api_calls(
            workflow_state,
            strategy,
            api_calls,
            f"正在调用 API：{provider.name}，最多尝试 {max_attempts} 次。",
            live_call={
                "call_index": call_index,
                "call_type": call_type,
                "provider_id": provider.id,
                "provider_name": provider.name,
                "prompt": prompt,
                "response": "",
                "parsed_response": {},
                "status": "running",
                "error_message": "",
                "skipped": False,
                "duration_ms": 0,
                "attempt_count": 0,
                "attempts": [],
                "created_at": datetime.utcnow().isoformat(),
            },
            extra={"current_attempt": {"attempt_index": 0, "max_attempts": max_attempts, "status": "pending"}},
        )
        for attempt_index in range(1, max_attempts + 1):
            if not can_make_workflow_call(workflow_state):
                limit = workflow_state.get("max_total_api_calls")
                message = f"max_total_api_calls 已达到上限（{limit}），接口重试已停止。"
                workflow_state.setdefault("global_warnings", []).append(message)
                attempts.append(
                    {
                        "attempt_index": attempt_index,
                        "status": "error",
                        "status_code": None,
                        "error_message": message,
                        "duration_ms": 0,
                        "will_retry": False,
                        "created_at": datetime.utcnow().isoformat(),
                    }
                )
                self._publish_live_api_calls(
                    workflow_state,
                    strategy,
                    api_calls,
                    "工作流总 API 调用次数已达到上限，停止当前节点重试。",
                    live_call={
                        "call_index": call_index,
                        "call_type": call_type,
                        "provider_id": provider.id,
                        "provider_name": provider.name,
                        "prompt": prompt,
                        "response": "",
                        "parsed_response": {},
                        "status": "error",
                        "error_message": message,
                        "skipped": False,
                        "duration_ms": int((time.perf_counter() - total_started) * 1000),
                        "attempt_count": len(attempts),
                        "attempts": attempts,
                        "created_at": datetime.utcnow().isoformat(),
                    },
                    extra={"current_attempt": {"attempt_index": attempt_index, "max_attempts": max_attempts, "status": "error", "error_message": message}},
                )
                break
            register_workflow_api_call(workflow_state)
            attempt_started = time.perf_counter()
            self._publish_live_api_calls(
                workflow_state,
                strategy,
                api_calls,
                f"正在进行第 {attempt_index}/{max_attempts} 次 API 请求，请等待中转站返回。",
                live_call={
                    "call_index": call_index,
                    "call_type": call_type,
                    "provider_id": provider.id,
                    "provider_name": provider.name,
                    "prompt": prompt,
                    "response": "",
                    "parsed_response": {},
                    "status": "running",
                    "error_message": "",
                    "skipped": False,
                    "duration_ms": int((time.perf_counter() - total_started) * 1000),
                    "attempt_count": len(attempts),
                    "attempts": attempts
                    + [
                        {
                            "attempt_index": attempt_index,
                            "status": "running",
                            "status_code": None,
                            "error_message": "",
                            "duration_ms": 0,
                            "will_retry": False,
                            "created_at": datetime.utcnow().isoformat(),
                        }
                    ],
                    "created_at": datetime.utcnow().isoformat(),
                },
                extra={"current_attempt": {"attempt_index": attempt_index, "max_attempts": max_attempts, "status": "running"}},
            )
            result = await self.provider_client.complete(provider, prompt, system_prompt)
            attempt_duration_ms = result.duration_ms if isinstance(result.duration_ms, int) else int((time.perf_counter() - attempt_started) * 1000)
            will_retry = should_retry_provider_result(result) and attempt_index < max_attempts
            attempts.append(
                {
                    "attempt_index": attempt_index,
                    "status": result.status,
                    "status_code": result.status_code,
                    "error_message": result.error or "",
                    "duration_ms": attempt_duration_ms,
                    "will_retry": will_retry,
                    "created_at": datetime.utcnow().isoformat(),
                }
            )
            retry_delay = provider_retry_delay(attempt_index, self.settings.provider_retry_base_delay_seconds, self.settings.provider_retry_max_delay_seconds)
            self._publish_live_api_calls(
                workflow_state,
                strategy,
                api_calls,
                (
                    f"第 {attempt_index}/{max_attempts} 次 API 请求失败，{retry_delay:.1f} 秒后重试。"
                    if will_retry
                    else f"第 {attempt_index}/{max_attempts} 次 API 请求已返回：{result.status}。"
                ),
                live_call={
                    "call_index": call_index,
                    "call_type": call_type,
                    "provider_id": provider.id,
                    "provider_name": provider.name,
                    "prompt": prompt,
                    "response": result.content if result.status == "success" else "",
                    "parsed_response": parse_json_object(result.content) or {},
                    "status": "retrying" if will_retry else result.status,
                    "error_message": result.error or "",
                    "skipped": False,
                    "duration_ms": int((time.perf_counter() - total_started) * 1000),
                    "attempt_count": len(attempts),
                    "attempts": attempts,
                    "created_at": datetime.utcnow().isoformat(),
                    "workflow_api_call_count": int(workflow_state.get("api_call_count") or 0) if workflow_state else None,
                    "max_total_api_calls": workflow_state.get("max_total_api_calls") if workflow_state else None,
                },
                extra={
                    "current_attempt": {
                        "attempt_index": attempt_index,
                        "max_attempts": max_attempts,
                        "status": "retrying" if will_retry else result.status,
                        "error_message": result.error or "",
                    }
                },
            )
            if not will_retry:
                break
            await asyncio.sleep(retry_delay)
        duration_ms = int((time.perf_counter() - total_started) * 1000)
        if result is None:
            result = type("ProviderRetryResult", (), {"content": "", "status": "error", "error": attempts[-1]["error_message"] if attempts else "Provider retry failed", "status_code": None})()
        call = {
            "call_index": len(api_calls) + 1,
            "call_type": call_type,
            "provider_id": provider.id,
            "provider_name": provider.name,
            "prompt": prompt,
            "response": result.content,
            "parsed_response": parse_json_object(result.content) or {},
            "status": result.status,
            "error_message": result.error or "",
            "skipped": False,
            "duration_ms": duration_ms,
            "attempt_count": len(attempts),
            "attempts": attempts,
            "created_at": datetime.utcnow().isoformat(),
            "workflow_api_call_count": int(workflow_state.get("api_call_count") or 0) if workflow_state else None,
            "max_total_api_calls": workflow_state.get("max_total_api_calls") if workflow_state else None,
        }
        api_calls.append(call)
        self._publish_live_api_calls(
            workflow_state,
            strategy,
            api_calls,
            "API 调用完成，正在整理节点输出。" if call["status"] == "success" else "API 调用失败，正在生成错误输出。",
            extra={"current_attempt": {"attempt_index": len(attempts), "max_attempts": max_attempts, "status": call["status"], "error_message": call.get("error_message") or ""}},
        )
        return call

    def _start_node(self, project_id: int, config: dict[str, Any]) -> dict[str, Any]:
        use_all = bool(config.get("use_all_project_files", True))
        file_ids = config.get("file_ids") or []
        query = self.db.query(FileAsset).filter(FileAsset.project_id == project_id)
        if not use_all:
            numeric_ids = [int(item) for item in file_ids if str(item).isdigit()]
            query = query.filter(FileAsset.id.in_(numeric_ids)) if numeric_ids else query.filter(False)
        assets = query.order_by(FileAsset.created_at.asc()).all()
        files = [
            {
                "file_id": asset.id,
                "filename": asset.original_name,
                "mime_type": asset.mime_type,
                "text": asset.extracted_text or "",
            }
            for asset in assets
        ]
        manual_text = str(config.get("text") or "").strip()
        parts = []
        if manual_text:
            parts.append(f"# Manual Input\n\n{manual_text}")
        for item in files:
            parts.append(f"# File: {item['filename']}\n\n{item['text']}")
        combined_text = "\n\n---\n\n".join(parts)
        payload = {
            "files": files,
            "file_count": len(files),
            "manual_text": manual_text,
            "combined_text": combined_text,
        }
        key = config.get("output_key") or "materials"
        return {key: payload, "content": combined_text, "file_count": len(files)}

    async def _cross_review(self, project_id: int, config: dict[str, Any], upstream: dict[str, Any], context_package: dict[str, Any] | None = None) -> dict[str, Any]:
        provider_ids = config.get("reviewer_provider_ids") or []
        if not provider_ids:
            provider_ids = [provider.id for provider in self._project_providers(project_id)]
        criteria = config.get("review_criteria") or "Review differences, errors, risks, and improvement suggestions."
        context_package = context_package or {}
        user_prompt = render_template(str(config.get("prompt_template") or ""), upstream, context_package).strip()
        schema_guard = (
            "CROSS_REVIEW_SCHEMA: Return strict JSON with keys agreement_points, conflict_points, "
            "missing_constraints, logic_errors, risk_level, recommended_action, revision_instructions, "
            "final_summary, raw_reviews, agreement, conflict, missing, logic_error, risk, revision_tasks, routed_outputs. "
            "Also include source_coverage_issues, unsupported_claims, recommended_retrieval_queries, nodes_to_rerun. "
            "Use routed_outputs to map categories agreement/conflict/missing/logic_error/risk/revision_tasks for downstream edge conditions."
        )
        prompt = f"{schema_guard}\nCriteria: {criteria}\n{user_prompt}\nContext Package:\n{json.dumps(context_package, ensure_ascii=False)}\nInputs:\n{json.dumps(upstream, ensure_ascii=False)}"
        raw_reviews = []
        for provider_id in provider_ids[: max(1, int(config.get("max_rounds") or 1)) * max(1, len(provider_ids))]:
            provider = self._provider(project_id, provider_id)
            result = await self.provider_client.complete(provider, prompt, str(config.get("system_prompt") or ""))
            raw_reviews.append({"provider_id": provider.id, "provider_name": provider.name, "status": result.status, "content": result.content, "error": result.error})
        primary = raw_reviews[0]["content"] if raw_reviews else ""
        parsed = parse_cross_review(primary)
        parsed["raw_reviews"] = raw_reviews
        if not parsed["final_summary"]:
            parsed["final_summary"] = "Cross review completed with fallback structured output."
        parsed["routed_outputs"] = build_cross_review_routes(parsed)
        parsed.update(standard_output_fields(parsed, context_package))
        return parsed

    async def _skill_node(self, project_id: int, config: dict[str, Any], upstream: dict[str, Any], context_package: dict[str, Any] | None = None) -> dict[str, Any]:
        skill_name = str(config.get("skill_name") or "Markdown Skill")
        markdown_content = str(config.get("markdown_content") or "").strip()
        context_package = context_package or {}
        rendered_instruction = render_template(markdown_content, upstream, context_package)
        upstream_json = json.dumps(upstream, ensure_ascii=False, indent=2)
        context_json = json.dumps(context_package, ensure_ascii=False, indent=2)
        provider = self._provider(project_id, config.get("provider_id"))
        prompt = (
            f"# Skill: {skill_name}\n\n"
            "你正在执行一个工作流 Skill 节点。必须等待上游节点完整输出后，再基于完整 output_json 处理。\n\n"
            "请优先使用 Context Package 中的 selected_artifacts 和 retrieved_material_chunks。"
            "必须尽量输出结构化 JSON，字段包括 artifact、source_refs、missing_information、retrieval_queries、need_more_context、confidence、next_node_instruction。"
            "如果资料不足，请设置 need_more_context=true 并给出 retrieval_queries。\n\n"
            "## Skill 专用 Markdown 指令\n\n"
            f"{rendered_instruction or '未配置 Markdown Skill 指令。请整理上游完整输出。'}\n\n"
            "## Context Package\n\n"
            f"```json\n{context_json}\n```\n\n"
            "## 上游完整 output_json\n\n"
            f"```json\n{upstream_json}\n```\n\n"
            "请输出完整处理结果，供下游 API / 交叉验证节点通过箭头继续使用。"
        )
        result = await self.provider_client.complete(provider, prompt, str(config.get("system_prompt") or ""))
        if result.status != "success":
            raise WorkflowExecutionError(result.error or "Skill provider call failed")
        processed_markdown = result.content
        standard = standard_model_output(processed_markdown)
        skill_output = {
            "skill_name": skill_name,
            "provider_id": provider.id,
            "provider_name": provider.name,
            "model_name": provider.model_name,
            "instruction": rendered_instruction,
            "source_outputs": upstream,
            "processed_markdown": processed_markdown,
            "raw_model_output": result.content,
        }
        key = config.get("output_key") or "skill_output"
        return {
            key: skill_output,
            "content": processed_markdown,
            "skill_name": skill_name,
            "provider_id": provider.id,
            "provider_name": provider.name,
            "next_node_instruction": standard.get("next_node_instruction", ""),
            **standard,
        }

    async def _code_generation(self, project_id: int, config: dict[str, Any], upstream: dict[str, Any], context_package: dict[str, Any] | None = None) -> dict[str, Any]:
        provider = self._provider(project_id, config.get("provider_id"))
        prompt = render_template(config.get("prompt_template", "Generate Python code."), upstream, context_package or {})
        result = await self.provider_client.complete(provider, prompt, str(config.get("system_prompt") or ""))
        if result.status != "success":
            raise WorkflowExecutionError(result.error or "Code generation failed")
        code_text = extract_code(result.content)
        filename = config.get("output_filename") or "main.py"
        if Path(filename).is_absolute() or ".." in Path(filename).parts:
            raise WorkflowExecutionError("Invalid output filename")
        target = safe_child_path(workspace_dir(project_id), filename)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(code_text, encoding="utf-8")
        return {"code_text": code_text, "file_path": str(target)}

    def _code_execution(self, project_id: int, config: dict[str, Any]) -> dict[str, Any]:
        command = str(config.get("command") or "python main.py").strip()
        assert_safe_command(command)
        timeout = max(1, min(int(config.get("timeout_seconds") or 10), 60))
        root = workspace_dir(project_id)
        working_directory = str(config.get("working_directory") or ".")
        if Path(working_directory).is_absolute():
            raise WorkflowExecutionError("working_directory must be relative to workspace")
        cwd = safe_child_path(root, working_directory)
        cwd.mkdir(parents=True, exist_ok=True)
        args = shlex.split(command, posix=False)
        started = time.perf_counter()
        try:
            completed = subprocess.run(args, cwd=str(cwd), capture_output=True, text=True, timeout=timeout, shell=False)
            error_message = "" if completed.returncode == 0 else f"Command exited with code {completed.returncode}"
            return {
                "command": command,
                "timeout_seconds": timeout,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "exit_code": completed.returncode,
                "error_message": error_message,
                "duration_ms": int((time.perf_counter() - started) * 1000),
            }
        except subprocess.TimeoutExpired as exc:
            return {
                "command": command,
                "timeout_seconds": timeout,
                "stdout": exc.stdout or "",
                "stderr": exc.stderr or "",
                "exit_code": None,
                "error_message": "Command timed out",
                "duration_ms": int((time.perf_counter() - started) * 1000),
            }
        except Exception as exc:
            return {
                "command": command,
                "timeout_seconds": timeout,
                "stdout": "",
                "stderr": "",
                "exit_code": None,
                "error_message": str(exc),
                "duration_ms": int((time.perf_counter() - started) * 1000),
            }

    def _result_validation(self, project_id: int, config: dict[str, Any], upstream: dict[str, Any]) -> dict[str, Any]:
        errors: list[str] = []
        warnings: list[str] = []
        execution = find_latest_by_key(upstream, "exit_code")
        if execution is not None and execution != 0:
            errors.append(f"exit_code is {execution}")
        if config.get("check_stderr"):
            stderr = find_latest_by_key(upstream, "stderr")
            if stderr:
                warnings.append(f"stderr is not empty: {str(stderr)[:300]}")
        root = workspace_dir(project_id)
        for item in config.get("required_files") or []:
            try:
                target = safe_child_path(root, str(item))
                if not target.exists():
                    errors.append(f"Required file missing: {item}")
            except ValueError as exc:
                errors.append(str(exc))
        return {"passed": not errors, "errors": errors, "warnings": warnings}

    async def _document_write(self, project_id: int, config: dict[str, Any], upstream: dict[str, Any], context_package: dict[str, Any] | None = None) -> dict[str, Any]:
        provider_id = config.get("provider_id")
        markdown_text = ""
        if provider_id:
            provider = self._provider(project_id, provider_id)
            prompt = render_template(config.get("prompt_template", "Write Markdown report.\n{{previous_output}}"), upstream, context_package or {})
            result = await self.provider_client.complete(provider, prompt, str(config.get("system_prompt") or ""))
            markdown_text = result.content if result.status == "success" else ""
        if not markdown_text:
            markdown_text = "# Workflow Report\n\n```json\n" + json.dumps(upstream, ensure_ascii=False, indent=2) + "\n```\n"
        filename = config.get("output_filename") or "report.md"
        if not filename.endswith(".md"):
            filename += ".md"
        target = safe_child_path(outputs_dir(project_id), filename)
        target.write_text(markdown_text, encoding="utf-8")
        return {"markdown_text": markdown_text, "file_path": str(target)}

    async def _compliance_check(self, project_id: int, config: dict[str, Any], upstream: dict[str, Any]) -> dict[str, Any]:
        checklist = config.get("checklist") or []
        combined = json.dumps(upstream, ensure_ascii=False)
        issues = []
        revision_instructions = []
        for item in checklist:
            text = str(item)
            keyword = text.replace("是否有", "").replace("是否存在", "").strip()
            if keyword and keyword not in combined and len(keyword) < 12:
                issues.append(f"可能缺少：{keyword}")
        for placeholder in ["待补充", "TODO", "TBD"]:
            if placeholder in combined:
                issues.append(f"存在占位文本：{placeholder}")
        if issues:
            revision_instructions = [f"补充或修正：{issue}" for issue in issues]
        return {"passed": not issues, "issues": issues, "revision_instructions": revision_instructions}

    def _export_node(self, project_id: int, config: dict[str, Any], upstream: dict[str, Any]) -> dict[str, Any]:
        filename = config.get("output_filename") or "workflow_output.json"
        target = safe_child_path(outputs_dir(project_id), filename)
        payload = sanitize_payload({"export_format": config.get("export_format") or "json", "upstream": upstream})
        if filename.endswith(".md"):
            target.write_text("# Workflow Export\n\n```json\n" + json.dumps(payload, ensure_ascii=False, indent=2) + "\n```\n", encoding="utf-8")
        else:
            target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"file_path": str(target), "content": payload}

    def _provider(self, project_id: int, provider_id: int | str | None) -> ApiProvider:
        provider = None
        if provider_id:
            provider = self.db.get(ApiProvider, int(provider_id))
        if not provider:
            provider = self.db.query(ApiProvider).filter(ApiProvider.project_id == project_id, ApiProvider.enabled == True).first()  # noqa: E712
        if not provider or provider.project_id != project_id:
            raise WorkflowExecutionError("Provider not found for project")
        return provider

    def _project_providers(self, project_id: int) -> list[ApiProvider]:
        return self.db.query(ApiProvider).filter(ApiProvider.project_id == project_id, ApiProvider.enabled == True).all()  # noqa: E712


def normalize_workflow_json(workflow_json: dict[str, Any]) -> dict[str, Any]:
    data = workflow_json or {}
    nodes = data.get("nodes") or []
    edges = data.get("edges") or []
    normalized_nodes = []
    for node in nodes:
        node_data = node.get("data") or {}
        normalized_nodes.append(
            {
                "id": str(node.get("id")),
                "type": node.get("type") or node_data.get("type") or node_data.get("node_type"),
                "name": node.get("name") or node_data.get("name") or node_data.get("label") or str(node.get("id")),
                "position": node.get("position") or {"x": 0, "y": 0},
                "config": node_data.get("config") or node.get("config") or {},
                "inputs": node.get("inputs") or [],
                "outputs": node.get("outputs") or [],
            }
        )
    normalized_edges = []
    for edge in edges:
        normalized_edges.append(
            {
                "id": str(edge.get("id") or f"edge-{edge.get('source')}-{edge.get('target')}"),
                "source": str(edge.get("source")),
                "target": str(edge.get("target")),
                "source_handle": edge.get("source_handle") or edge.get("sourceHandle"),
                "target_handle": edge.get("target_handle") or edge.get("targetHandle"),
                "condition": edge.get("condition"),
                "transfer_mode": edge.get("transfer_mode") or edge.get("transferMode") or (edge.get("data") or {}).get("transfer_mode") or "full_output",
                "selected_paths": edge.get("selected_paths") or edge.get("selectedPaths") or (edge.get("data") or {}).get("selected_paths") or [],
            }
        )
    return {**data, "nodes": normalized_nodes, "edges": normalized_edges}


def runtime_node_type(node_type: str, config: dict[str, Any]) -> str:
    aliases = {
        "api_call": "llm_call",
        "skill_workflow": "skill",
        "markdown_output": "document_write",
        "report_output": "document_write",
        "json_output": "export",
        "consensus_merge": "merge",
        "format_check": "compliance_check",
        "fact_check": "compliance_check",
        "logic_check": "compliance_check",
        "prompt_router": "llm_call",
        "agent_tool": "llm_call",
        "python_tool": "code_execution",
        "web_request": "http_request",
    }
    if config.get("disabled"):
        return "note"
    return aliases.get(node_type, node_type)


def build_execution_plan(order: list[str], by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    plan = []
    for index, node_id in enumerate(order):
        node = by_id[node_id]
        config = node.get("config") or {}
        runtime_type = runtime_node_type(str(node.get("type")), config)
        execution_strategy = normalize_execution_strategy(config, runtime_type)
        plan.append(
            {
                "step": index + 1,
                "node_id": node_id,
                "node_name": node.get("name") or node_id,
                "node_type": node.get("type"),
                "runtime_type": runtime_type,
                "provider_id": config.get("provider_id"),
                "output_key": config.get("output_key"),
                "prompt_summary": config.get("prompt_summary") or config.get("skill_name") or "",
                "execution_strategy": execution_strategy.get("execution_strategy"),
                "max_api_calls": execution_strategy.get("max_api_calls"),
            }
        )
    return plan


def create_workflow_state(run_id: int | str) -> dict[str, Any]:
    return {
        "run_id": str(run_id),
        "requirement": {},
        "materials": {"run_id": str(run_id), "materials": {"sources": [], "chunks": []}},
        "artifacts": {},
        "node_outputs": {},
        "api_call_count": 0,
        "max_total_api_calls": 200,
        "global_warnings": [],
    }


def apply_workflow_limits(workflow_state: dict[str, Any], workflow_json: dict[str, Any]) -> None:
    metadata = workflow_json.get("metadata") if isinstance(workflow_json.get("metadata"), dict) else {}
    raw_limit = metadata.get("max_total_api_calls") or workflow_json.get("max_total_api_calls") or workflow_state.get("max_total_api_calls") or 200
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 200
    workflow_state["max_total_api_calls"] = max(1, min(limit, 1000))


def can_make_workflow_call(workflow_state: dict[str, Any] | None) -> bool:
    if not workflow_state:
        return True
    return int(workflow_state.get("api_call_count") or 0) < int(workflow_state.get("max_total_api_calls") or 200)


def register_workflow_api_call(workflow_state: dict[str, Any] | None) -> None:
    if not workflow_state:
        return
    workflow_state["api_call_count"] = int(workflow_state.get("api_call_count") or 0) + 1


def workflow_api_call_summary(workflow_state: dict[str, Any]) -> dict[str, Any]:
    return {
        "actual_total_api_call_count": int(workflow_state.get("api_call_count") or 0),
        "max_total_api_calls": int(workflow_state.get("max_total_api_calls") or 200),
        "global_warnings": workflow_state.get("global_warnings") or [],
    }


def provider_retry_max_attempts(provider: ApiProvider, configured_attempts: int) -> int:
    if provider.provider_type == "mock":
        return 1
    return max(1, min(int(configured_attempts or 5), 10))


def provider_retry_delay(attempt_index: int, base_delay: float, max_delay: float) -> float:
    base = max(0.0, float(base_delay or 1.0))
    cap = max(base, float(max_delay or 8.0))
    return min(cap, base * (2 ** max(0, attempt_index - 1)))


def should_retry_provider_result(result: Any) -> bool:
    if getattr(result, "status", "") == "success":
        return False
    status_code = getattr(result, "status_code", None)
    if isinstance(status_code, int):
        return status_code in {408, 409, 425, 429, 500, 502, 503, 504}
    error = str(getattr(result, "error", "") or "").lower()
    retry_markers = [
        "timeout",
        "timed out",
        "request failed",
        "connection",
        "network",
        "502",
        "503",
        "504",
        "429",
        "bad gateway",
        "temporarily",
        "中转站超时",
        "超时",
    ]
    non_retry_markers = [
        "api_key is required",
        "base_url is required",
        "401",
        "403",
        "unauthorized",
        "forbidden",
        "invalid api key",
        "unsupported provider type",
        "provider is disabled",
    ]
    if any(marker in error for marker in non_retry_markers):
        return False
    return any(marker in error for marker in retry_markers)


def is_recoverable_node_error(exc: Exception) -> bool:
    if not isinstance(exc, WorkflowExecutionError):
        return False
    output = exc.output_json if isinstance(exc.output_json, dict) else {}
    if output.get("api_calls"):
        return True
    message = str(exc)
    recoverable_markers = [
        "HTTP ",
        "Request timed out",
        "请求中转站超时",
        "Provider is disabled",
        "base_url is required",
        "api_key is required",
        "Model call failed",
        "provider call failed",
        "调用失败",
    ]
    return any(marker in message for marker in recoverable_markers)


def build_step_input(
    index: int,
    order: list[str],
    execution_plan: list[dict[str, Any]],
    node: dict[str, Any],
    upstream: dict[str, Any],
    prompt_context: dict[str, Any],
    context_package: dict[str, Any],
    retry_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "execution": {
            "mode": "sequential",
            "current_step": index + 1,
            "total_steps": len(order),
            "execution_plan": execution_plan,
            "transfer_rule": "Start runs nodes sequentially by arrow order. A node passes its complete output_json to downstream nodes only after it finishes.",
        },
        "prompt": prompt_context,
        "node": node,
        "upstream": upstream,
        "context_package": context_package,
        "retrieved_material_chunks": context_package.get("retrieved_material_chunks", []),
        "source_refs": context_package.get("source_refs", []),
        "missing_information": context_package.get("missing_context", []),
        "retry_info": retry_info or {},
    }


def build_prompt_context(node: dict[str, Any], upstream: dict[str, Any], context_package: dict[str, Any] | None = None) -> dict[str, Any]:
    config = node.get("config") or {}
    node_type = runtime_node_type(str(node.get("type")), config)
    context_package = context_package or {}
    context: dict[str, Any] = {
        "uses_prompt": False,
        "provider_id": config.get("provider_id"),
        "system_prompt": config.get("system_prompt") or "",
        "context_config": effective_context_config(node),
        "context_package": context_package,
    }

    if node_type in {"llm_call", "parallel_llm", "code_generation", "document_write"}:
        default_template = "Generate Python code." if node_type == "code_generation" else "Write Markdown report.\n{{previous_output}}" if node_type == "document_write" else ""
        template = str(config.get("prompt_template") or default_template)
        context.update(
            {
                "uses_prompt": True,
                "prompt_kind": "prompt_template",
                "prompt_template": template,
                "rendered_prompt": render_template(template, upstream, context_package),
            }
        )
    elif node_type == "skill":
        markdown_content = str(config.get("markdown_content") or "")
        context.update(
            {
                "uses_prompt": True,
                "prompt_kind": "skill_markdown",
                "skill_name": config.get("skill_name") or "Markdown Skill",
                "markdown_content": markdown_content,
                "rendered_prompt": render_template(markdown_content, upstream, context_package),
            }
        )
    elif node_type == "cross_review":
        template = str(config.get("prompt_template") or "")
        context.update(
            {
                "uses_prompt": True,
                "prompt_kind": "cross_review",
                "review_criteria": config.get("review_criteria") or "",
                "reviewer_provider_ids": config.get("reviewer_provider_ids") or [],
                "prompt_template": template,
                "rendered_prompt": render_template(template, upstream, context_package),
            }
        )
    return context


def topological_sort(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[str]:
    ids = [str(node["id"]) for node in nodes]
    indegree = {node_id: 0 for node_id in ids}
    graph = {node_id: [] for node_id in ids}
    for edge in edges:
        source = str(edge["source"])
        target = str(edge["target"])
        if source not in graph or target not in indegree:
            raise WorkflowExecutionError(f"Invalid edge: {source} -> {target}")
        graph[source].append(target)
        indegree[target] += 1
    queue = [node_id for node_id in ids if indegree[node_id] == 0]
    order = []
    while queue:
        node_id = queue.pop(0)
        order.append(node_id)
        for target in graph[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if len(order) != len(ids):
        raise WorkflowExecutionError("Workflow graph contains a cycle")
    return order


def workflow_execution_order(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[str]:
    ids = {str(node["id"]) for node in nodes}
    by_id = {str(node["id"]): node for node in nodes}
    graph = {node_id: [] for node_id in ids}
    indegree = {node_id: 0 for node_id in ids}
    edge_index: dict[tuple[str, str], int] = {}
    for index, edge in enumerate(edges):
        source = str(edge["source"])
        target = str(edge["target"])
        if source not in graph or target not in indegree:
            raise WorkflowExecutionError(f"Invalid edge: {source} -> {target}")
        graph[source].append(target)
        indegree[target] += 1
        edge_index[(source, target)] = index

    start_ids = [node_id for node_id, node in by_id.items() if str(node.get("type")) == "start"]
    roots = start_ids or [node_id for node_id in ids if indegree[node_id] == 0]
    if not roots:
        raise WorkflowExecutionError("Workflow graph must contain a start node or at least one root node")

    def node_sort_key(node_id: str) -> tuple[float, float, str]:
        position = by_id.get(node_id, {}).get("position") or {}
        return (float(position.get("x") or 0), float(position.get("y") or 0), node_id)

    visited_reachable: set[str] = set()
    stack = sorted(roots, key=node_sort_key)
    while stack:
        current = stack.pop(0)
        if current in visited_reachable:
            continue
        visited_reachable.add(current)
        children = sorted(graph.get(current, []), key=lambda target: (edge_index.get((current, target), 0), *node_sort_key(target)))
        stack.extend(child for child in children if child not in visited_reachable)

    reachable_nodes = [node for node in nodes if str(node["id"]) in visited_reachable]
    reachable_edges = [edge for edge in edges if str(edge["source"]) in visited_reachable and str(edge["target"]) in visited_reachable]
    order = topological_sort(reachable_nodes, reachable_edges)
    return stable_order_by_arrows(order, reachable_edges, by_id, edge_index)


def stable_order_by_arrows(order: list[str], edges: list[dict[str, Any]], by_id: dict[str, dict[str, Any]], edge_index: dict[tuple[str, str], int]) -> list[str]:
    order_index = {node_id: index for index, node_id in enumerate(order)}
    graph = {node_id: [] for node_id in order}
    indegree = {node_id: 0 for node_id in order}
    for edge in edges:
        source = str(edge["source"])
        target = str(edge["target"])
        if source in graph and target in indegree:
            graph[source].append(target)
            indegree[target] += 1

    def sort_key(node_id: str) -> tuple[int, float, float, str]:
        position = by_id.get(node_id, {}).get("position") or {}
        incoming_indices = [edge_index.get((str(edge["source"]), str(edge["target"])), order_index[node_id]) for edge in edges if str(edge["target"]) == node_id]
        first_edge = min(incoming_indices) if incoming_indices else order_index[node_id]
        return (first_edge, float(position.get("x") or 0), float(position.get("y") or 0), node_id)

    queue = sorted([node_id for node_id, degree in indegree.items() if degree == 0], key=sort_key)
    result: list[str] = []
    while queue:
        node_id = queue.pop(0)
        result.append(node_id)
        for target in sorted(graph[node_id], key=sort_key):
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
                queue.sort(key=sort_key)
    if len(result) != len(order):
        raise WorkflowExecutionError("Workflow graph contains a cycle")
    return result


def collect_upstream(node_id: str, edges: list[dict[str, Any]], node_outputs: dict[str, dict[str, Any]], workflow_state: dict[str, Any] | None = None) -> dict[str, Any]:
    upstream: dict[str, Any] = {}
    for edge in edges:
        if str(edge["target"]) != node_id:
            continue
        source = str(edge["source"])
        output = node_outputs.get(source, {})
        upstream[source] = transfer_edge_output(edge, output, workflow_state or {})
    return upstream


def upstream_dependencies(node_id: str, edges: list[dict[str, Any]]) -> set[str]:
    parents: dict[str, set[str]] = {}
    for edge in edges:
        parents.setdefault(str(edge["target"]), set()).add(str(edge["source"]))
    result: set[str] = set()
    stack = list(parents.get(str(node_id), set()))
    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.add(current)
        stack.extend(parents.get(current, set()))
    return result


def last_output(order: list[str], node_outputs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return node_outputs.get(order[-1], {}) if order else {}


def render_template(template: str, upstream: dict[str, Any], context_package: dict[str, Any] | None = None) -> str:
    context_package = context_package or {}
    previous = ""
    all_upstream = ""
    if upstream:
        previous = json.dumps(list(upstream.values())[-1], ensure_ascii=False, indent=2)
        all_upstream = json.dumps(upstream, ensure_ascii=False, indent=2)
    rendered = (
        template.replace("{{previous_output}}", previous)
        .replace("{{input}}", all_upstream)
        .replace("{{upstream}}", all_upstream)
        .replace("{{context_package}}", json.dumps(context_package, ensure_ascii=False, indent=2))
        .replace("{{selected_artifacts}}", json.dumps(context_package.get("selected_artifacts", {}), ensure_ascii=False, indent=2))
        .replace("{{retrieved_material_chunks}}", json.dumps(context_package.get("retrieved_material_chunks", []), ensure_ascii=False, indent=2))
    )
    for node_id, output in upstream.items():
        if isinstance(output, dict):
            for key, value in output.items():
                rendered = rendered.replace(f"{{{{node.{node_id}.{key}}}}}", str(value))
    return rendered


def parse_cross_review(raw: str) -> dict[str, Any]:
    parsed = None
    try:
        parsed = json.loads(raw)
    except Exception:
        match = re.search(r"\{.*\}", raw or "", re.S)
        if match:
            try:
                parsed = json.loads(match.group(0))
            except Exception:
                parsed = None
    result = dict(CROSS_REVIEW_DEFAULT)
    if isinstance(parsed, dict):
        for key in result:
            if key in parsed and key != "raw_reviews":
                result[key] = parsed[key]
        aliases = {
            "agreement": "agreement_points",
            "conflict": "conflict_points",
            "missing": "missing_constraints",
            "logic_error": "logic_errors",
            "revision_tasks": "revision_instructions",
        }
        for alias, source_key in aliases.items():
            if alias in parsed and parsed[alias]:
                result[alias] = parsed[alias]
            elif source_key in parsed:
                result[alias] = parsed[source_key]
        if "risk" in parsed and parsed["risk"]:
            result["risk"] = parsed["risk"]
        else:
            result["risk"] = {"risk_level": result["risk_level"]}
    if result["risk_level"] not in {"low", "medium", "high"}:
        result["risk_level"] = "medium"
    if not result["risk"]:
        result["risk"] = {"risk_level": result["risk_level"]}
    if result["recommended_action"] not in {"accept", "merge", "revise", "human_review"}:
        result["recommended_action"] = "human_review"
    if not result["revision_instructions"] and raw:
        result["revision_instructions"] = ["Review model output manually because JSON parsing required fallback."]
    result["agreement"] = result["agreement"] or result["agreement_points"]
    result["conflict"] = result["conflict"] or result["conflict_points"]
    result["missing"] = result["missing"] or result["missing_constraints"]
    result["logic_error"] = result["logic_error"] or result["logic_errors"]
    result["revision_tasks"] = result["revision_tasks"] or result["revision_instructions"]
    result["routed_outputs"] = build_cross_review_routes(result)
    return result


def build_cross_review_routes(review: dict[str, Any]) -> dict[str, Any]:
    routes = review.get("routed_outputs")
    base_routes = routes if isinstance(routes, dict) else {}
    return {
        "agreement": base_routes.get("agreement", review.get("agreement") or review.get("agreement_points") or []),
        "conflict": base_routes.get("conflict", review.get("conflict") or review.get("conflict_points") or []),
        "missing": base_routes.get("missing", review.get("missing") or review.get("missing_constraints") or []),
        "logic_error": base_routes.get("logic_error", review.get("logic_error") or review.get("logic_errors") or []),
        "risk": base_routes.get("risk", review.get("risk") or {"risk_level": review.get("risk_level", "medium")}),
        "revision_tasks": base_routes.get("revision_tasks", review.get("revision_tasks") or review.get("revision_instructions") or []),
    }


def material_store_from_start_output(run_id: str, output: dict[str, Any]) -> dict[str, Any]:
    materials = extract_start_materials(output)
    sources: list[dict[str, Any]] = []
    chunks: list[dict[str, Any]] = []

    manual_text = str(materials.get("manual_text") or "").strip()
    if manual_text:
        source_id = "manual_text"
        sources.append({"source_id": source_id, "source_type": "manual_text", "file_name": "", "content": manual_text, "metadata": {}})
        chunks.extend(chunk_source(source_id, manual_text, {"source_type": "manual_text"}))

    for index, file_item in enumerate(materials.get("files") or [], start=1):
        text = str(file_item.get("text") or "")
        source_id = f"file_{file_item.get('file_id') or index}"
        sources.append(
            {
                "source_id": source_id,
                "source_type": "file",
                "file_name": file_item.get("filename") or "",
                "content": text,
                "metadata": {"file_id": file_item.get("file_id"), "mime_type": file_item.get("mime_type")},
            }
        )
        chunks.extend(chunk_source(source_id, text, {"source_type": "file", "file_name": file_item.get("filename") or ""}))

    if not sources and output.get("content"):
        text = str(output.get("content") or "")
        sources.append({"source_id": "start_content", "source_type": "manual_text", "file_name": "", "content": text, "metadata": {"fallback": True}})
        chunks.extend(chunk_source("start_content", text, {"source_type": "manual_text", "fallback": True}))

    return {"run_id": str(run_id), "materials": {"sources": sources, "chunks": chunks}}


def extract_start_materials(output: dict[str, Any]) -> dict[str, Any]:
    if isinstance(output.get("materials"), dict):
        return output["materials"]
    for value in output.values():
        if isinstance(value, dict) and {"files", "manual_text", "combined_text"} & set(value.keys()):
            return value
    return {"files": [], "manual_text": "", "combined_text": output.get("content", "")}


def chunk_source(source_id: str, content: str, metadata: dict[str, Any], chunk_size: int = 3000, overlap: int = 300) -> list[dict[str, Any]]:
    text = content or ""
    if not text:
        return []
    chunks = []
    start = 0
    index = 1
    while start < len(text):
        end = min(len(text), start + chunk_size)
        piece = text[start:end]
        chunks.append(
            {
                "chunk_id": f"{source_id}_chunk_{index:03d}",
                "source_id": source_id,
                "chunk_index": index,
                "content": piece,
                "char_count": len(piece),
                "metadata": {**metadata, "start": start, "end": end},
            }
        )
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
        index += 1
    return chunks


def effective_context_config(node: dict[str, Any]) -> dict[str, Any]:
    config = node.get("config") or {}
    node_type = runtime_node_type(str(node.get("type")), config)
    if not isinstance(config.get("context_config"), dict):
        return {
            "context_mode": "full_previous",
            "include_upstream_outputs": True,
            "include_materials": False,
            "selected_input_paths": [],
            "required_artifacts": [],
            "material_retrieval": {
                "enabled": False,
                "query_template": "{{skill_name}} {{markdown_content}} {{previous_output}}",
                "max_chunks": 8,
                "max_chars": 20000,
            },
        }
    default_mode = "full_previous"
    include_materials = False
    retrieval_enabled = False
    if node_type == "skill":
        default_mode = "hybrid"
        include_materials = True
        retrieval_enabled = True
    if node_type == "cross_review":
        default_mode = "hybrid"
        include_materials = True
        retrieval_enabled = True
    user = config.get("context_config") if isinstance(config.get("context_config"), dict) else {}
    retrieval = user.get("material_retrieval") if isinstance(user.get("material_retrieval"), dict) else {}
    return {
        "context_mode": user.get("context_mode") or default_mode,
        "include_upstream_outputs": bool(user.get("include_upstream_outputs", True)),
        "include_materials": bool(user.get("include_materials", include_materials)),
        "selected_input_paths": user.get("selected_input_paths") or [],
        "required_artifacts": user.get("required_artifacts") or [],
        "material_retrieval": {
            "enabled": bool(retrieval.get("enabled", retrieval_enabled)),
            "query_template": retrieval.get("query_template") or "{{skill_name}} {{markdown_content}} {{previous_output}}",
            "max_chunks": int(retrieval.get("max_chunks") or user.get("max_chunks") or 8),
            "max_chars": int(retrieval.get("max_chars") or user.get("max_chars") or 20000),
        },
    }


def build_node_context(run_id: str, node: dict[str, Any], upstream_outputs: dict[str, Any], workflow_state: dict[str, Any]) -> dict[str, Any]:
    config = node.get("config") or {}
    context_config = effective_context_config(node)
    mode = context_config["context_mode"]
    selected_artifacts, warnings = select_artifacts(context_config.get("required_artifacts") or [], workflow_state)
    previous_outputs = upstream_outputs if context_config.get("include_upstream_outputs", True) or mode in {"previous_only", "full_previous", "hybrid"} else {}
    if mode == "selected_paths":
        previous_outputs = select_paths_from_value(upstream_outputs, context_config.get("selected_input_paths") or [], warnings)
    if mode == "previous_only":
        previous_outputs = upstream_outputs

    retrieved_chunks: list[dict[str, Any]] = []
    retrieval = context_config.get("material_retrieval") or {}
    if context_config.get("include_materials") or mode in {"material_retrieval", "hybrid"} or retrieval.get("enabled"):
        query = render_template(
            str(retrieval.get("query_template") or ""),
            upstream_outputs,
            {"selected_artifacts": selected_artifacts, "retrieved_material_chunks": []},
        )
        query = query.replace("{{skill_name}}", str(config.get("skill_name") or "")).replace("{{markdown_content}}", str(config.get("markdown_content") or ""))
        retrieved_chunks = retrieve_material_chunks(workflow_state.get("materials") or {}, query, int(retrieval.get("max_chunks") or 8), int(retrieval.get("max_chars") or 20000))

    missing_context = []
    for required in context_config.get("required_artifacts") or []:
        if required not in selected_artifacts:
            missing_context.append(f"missing required artifact: {required}")
    missing_context.extend(warnings)

    source_refs = [
        {"source_id": item.get("source_id"), "chunk_id": item.get("chunk_id"), "reason": item.get("reason", "material_retrieval")}
        for item in retrieved_chunks
    ]
    return {
        "target_node_id": node.get("id"),
        "target_node_type": node.get("type"),
        "task": {"name": node.get("name"), "prompt_summary": config.get("prompt_summary") or config.get("skill_name") or ""},
        "previous_outputs": previous_outputs,
        "selected_artifacts": selected_artifacts,
        "retrieved_material_chunks": retrieved_chunks,
        "constraints": config.get("constraints") or [],
        "missing_context": missing_context,
        "is_context_sufficient": not missing_context,
        "context_config": context_config,
        "source_refs": source_refs,
    }


def retrieve_material_chunks(material_store: dict[str, Any], query: str, max_chunks: int, max_chars: int) -> list[dict[str, Any]]:
    chunks = ((material_store or {}).get("materials") or {}).get("chunks") or []
    if not chunks:
        return []
    terms = {term.lower() for term in re.findall(r"[\w\u4e00-\u9fff]{2,}", query or "")}
    scored = []
    for chunk in chunks:
        content = str(chunk.get("content") or "")
        lower = content.lower()
        score = sum(1 for term in terms if term in lower)
        if score == 0 and not terms:
            score = 1
        scored.append((score, chunk))
    scored.sort(key=lambda item: item[0], reverse=True)
    selected = []
    total = 0
    for score, chunk in scored:
        if score <= 0 and selected:
            continue
        content = str(chunk.get("content") or "")
        if total + len(content) > max_chars and selected:
            break
        selected.append({**chunk, "reason": f"keyword_score={score}"})
        total += len(content)
        if len(selected) >= max_chunks:
            break
    return selected


def select_artifacts(required: list[Any], workflow_state: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    artifacts = workflow_state.get("artifacts") or {}
    warnings = []
    if not required:
        return artifacts, warnings
    selected = {}
    for key in required:
        key_text = str(key)
        if key_text in artifacts:
            selected[key_text] = artifacts[key_text]
            continue
        matches = {node_id: artifact for node_id, artifact in artifacts.items() if artifact.get("output_key") == key_text or key_text in artifact}
        if matches:
            selected[key_text] = matches
        else:
            warnings.append(f"required_artifact not found: {key_text}")
    return selected, warnings


def standard_model_output(content: str) -> dict[str, Any]:
    parsed = parse_json_object(content)
    if isinstance(parsed, dict):
        base = standard_output_fields(parsed, {})
        artifact = parsed.get("artifact") if isinstance(parsed.get("artifact"), dict) else {"text": parsed.get("content") or content}
        return {**base, "artifact": artifact, "content": parsed.get("content") or content}
    return {
        "artifact": {"text": content},
        "content": content,
        "source_refs": [],
        "missing_information": [],
        "retrieval_queries": [],
        "need_more_context": False,
        "confidence": "medium",
    }


SUPPORTED_EXECUTION_STRATEGIES = {
    "single_pass",
    "retrieve_then_retry",
    "draft_review_revise",
    "multi_candidate_review",
    "map_reduce",
}


def normalize_execution_strategy(config: dict[str, Any], model_kind: str) -> dict[str, Any]:
    raw_strategy = str(config.get("execution_strategy") or "single_pass")
    strategy_name = raw_strategy if raw_strategy in SUPPORTED_EXECUTION_STRATEGIES else "single_pass"
    default_calls = {
        "single_pass": 1,
        "retrieve_then_retry": 2,
        "draft_review_revise": 3,
        "multi_candidate_review": 5,
        "map_reduce": 12,
    }[strategy_name]
    max_api_calls = max(1, min(int(config.get("max_api_calls") or default_calls), 30))
    map_reduce = config.get("map_reduce") if isinstance(config.get("map_reduce"), dict) else {}
    return {
        "execution_strategy": strategy_name,
        "model_kind": model_kind,
        "max_api_calls": max_api_calls,
        "retry_condition": config.get("retry_condition") or "need_more_context",
        "enable_self_review": bool(config.get("enable_self_review", False)),
        "reviewer_provider_id": config.get("reviewer_provider_id"),
        "candidate_count": max(1, min(int(config.get("candidate_count") or (3 if strategy_name == "multi_candidate_review" else 1)), 5)),
        "map_reduce": {
            "enabled": bool(map_reduce.get("enabled", strategy_name == "map_reduce")),
            "max_chunks": max(1, min(int(map_reduce.get("max_chunks") or config.get("max_chunks") or 10), 30)),
            "chunk_size": max(500, min(int(map_reduce.get("chunk_size") or 6000), 20000)),
            "chunk_overlap": max(0, min(int(map_reduce.get("chunk_overlap") or 500), 3000)),
            "map_prompt": str(map_reduce.get("map_prompt") or ""),
            "reduce_prompt": str(map_reduce.get("reduce_prompt") or ""),
        },
    }


def can_make_call(strategy: dict[str, Any], api_calls: list[dict[str, Any]], reserve: int = 0) -> bool:
    return len(api_calls) + reserve < int(strategy.get("max_api_calls") or 1)


def strategy_trace(strategy: dict[str, Any], api_calls: list[dict[str, Any]], retry_info: dict[str, Any] | None = None) -> dict[str, Any]:
    real_call_count = len([call for call in api_calls if not call.get("skipped")])
    return {
        "execution_strategy": strategy.get("execution_strategy") or "single_pass",
        "max_api_calls": strategy.get("max_api_calls") or 1,
        "actual_api_call_count": real_call_count,
        "api_call_attempt_count": len(api_calls),
        "provider_attempt_count": provider_attempt_count_from_calls(api_calls),
        "api_calls": api_calls,
        "retry_info": retry_info or {},
    }


def provider_attempt_count_from_calls(api_calls: list[dict[str, Any]]) -> int:
    total = 0
    for call in api_calls:
        attempts = call.get("attempts")
        if isinstance(attempts, list) and attempts:
            total += len(attempts)
        elif not call.get("skipped"):
            total += 1
    return total


def strategy_error_output(strategy: dict[str, Any], api_calls: list[dict[str, Any]], error_message: str) -> dict[str, Any]:
    return {
        "content": "",
        "artifact": {},
        "source_refs": [],
        "missing_information": [],
        "retrieval_queries": [],
        "need_more_context": False,
        "confidence": "low",
        "error": error_message,
        "error_message": error_message,
        "passed": False,
        **strategy_trace(strategy, api_calls),
    }


def build_model_prompt(model_kind: str, config: dict[str, Any], upstream: dict[str, Any], context_package: dict[str, Any], phase: str) -> str:
    if model_kind == "skill":
        skill_name = str(config.get("skill_name") or "Markdown Skill")
        markdown_content = render_template(str(config.get("markdown_content") or ""), upstream, context_package)
        return (
            f"# Skill: {skill_name}\n\n"
            "你正在执行一个工作流 Skill 节点。必须等待上游节点完整输出后，再基于完整 output_json 处理。\n"
            "请尽量输出结构化 JSON，字段包括 artifact、source_refs、missing_information、retrieval_queries、need_more_context、confidence、next_node_instruction。\n"
            "如果资料不足，请设置 need_more_context=true 并给出 retrieval_queries。\n\n"
            f"## 当前阶段\n{phase}\n\n"
            f"## Skill 专用 Markdown 指令\n{markdown_content or '未配置 Markdown Skill 指令。请整理上游完整输出。'}\n\n"
            f"## Context Package\n```json\n{json.dumps(context_package, ensure_ascii=False, indent=2)}\n```\n\n"
            f"## 上游完整 output_json\n```json\n{json.dumps(upstream, ensure_ascii=False, indent=2)}\n```"
        )
    template = str(config.get("prompt_template") or "")
    rendered = render_template(template, upstream, context_package)
    return (
        f"{rendered}\n\n"
        "请尽量输出结构化 JSON；如果只能输出文本，系统会自动包装为合法 output_json。\n"
        f"当前阶段：{phase}\n"
        f"Context Package:\n{json.dumps(context_package, ensure_ascii=False, indent=2)}"
    )


def model_output_from_content(
    model_kind: str,
    config: dict[str, Any],
    provider: ApiProvider,
    content: str,
    upstream: dict[str, Any],
    context_package: dict[str, Any],
    strategy: dict[str, Any],
    api_calls: list[dict[str, Any]],
    attach_calls: bool = True,
) -> dict[str, Any]:
    standard = standard_model_output(content)
    if model_kind == "skill":
        skill_name = str(config.get("skill_name") or "Markdown Skill")
        skill_output = {
            "skill_name": skill_name,
            "provider_id": provider.id,
            "provider_name": provider.name,
            "model_name": provider.model_name,
            "instruction": render_template(str(config.get("markdown_content") or ""), upstream, context_package),
            "source_outputs": upstream,
            "processed_markdown": content,
            "raw_model_output": content,
        }
        output = {
            config.get("output_key") or "skill_output": skill_output,
            "content": content,
            "skill_name": skill_name,
            "provider_id": provider.id,
            "provider_name": provider.name,
            "next_node_instruction": standard.get("next_node_instruction", ""),
            **standard,
        }
    else:
        key = config.get("output_key") or "content"
        output = {
            key: content,
            "output": content,
            "content": content,
            "provider_id": provider.id,
            "provider_name": provider.name,
            **standard,
        }
    if attach_calls:
        output.update(strategy_trace(strategy, api_calls))
    return output


def parsed_or_text(content: str) -> Any:
    parsed = parse_json_object(content)
    if parsed is not None:
        return parsed
    return {"content": content, "artifact": {"text": content}}


def content_from_value(value: Any) -> str:
    if isinstance(value, dict):
        content = value.get("content") or value.get("text") or value.get("final_summary")
        if content:
            return str(content)
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def compose_draft_review_output(
    config: dict[str, Any],
    draft: Any,
    review: Any,
    revised: Any,
    strategy: dict[str, Any],
    api_calls: list[dict[str, Any]],
    provider: ApiProvider,
) -> dict[str, Any]:
    content = content_from_value(revised)
    return {
        "draft": draft,
        "review": review,
        "revised": revised,
        "content": content,
        "artifact": revised if isinstance(revised, dict) else {"text": content},
        "provider_id": provider.id,
        "provider_name": provider.name,
        config.get("output_key") or "output": content,
        **standard_model_output(content),
        **strategy_trace(strategy, api_calls),
    }


def map_reduce_chunks(
    workflow_state: dict[str, Any],
    context_package: dict[str, Any],
    max_chunks: int,
    chunk_size: int,
    chunk_overlap: int,
) -> list[dict[str, Any]]:
    chunks = list(context_package.get("retrieved_material_chunks") or [])
    if not chunks:
        chunks = list(((workflow_state.get("materials") or {}).get("materials") or {}).get("chunks") or [])
    if not chunks:
        text = content_from_value(context_package.get("previous_outputs") or "")
        chunks = chunk_source("previous_outputs", text, {"source_type": "previous_outputs"}, chunk_size, chunk_overlap)
    normalized = []
    for chunk in chunks[:max_chunks]:
        if "content" in chunk:
            normalized.append(chunk)
        else:
            normalized.append({**chunk, "content": content_from_value(chunk)})
    return normalized[:max_chunks]


def standard_output_fields(output: dict[str, Any], context_package: dict[str, Any]) -> dict[str, Any]:
    return {
        "artifact": output.get("artifact") if isinstance(output.get("artifact"), dict) else {"text": output.get("content") or output.get("final_summary") or ""},
        "source_refs": output.get("source_refs") or context_package.get("source_refs") or [],
        "missing_information": output.get("missing_information") or output.get("missing_constraints") or [],
        "retrieval_queries": output.get("retrieval_queries") or output.get("recommended_retrieval_queries") or [],
        "need_more_context": bool(output.get("need_more_context", False)),
        "confidence": output.get("confidence") if output.get("confidence") in {"high", "medium", "low"} else "medium",
    }


def artifact_record_from_output(node: dict[str, Any], output: dict[str, Any], context_package: dict[str, Any]) -> dict[str, Any]:
    config = node.get("config") or {}
    standard = standard_output_fields(output, context_package)
    return {
        "node_type": node.get("type"),
        "output_key": config.get("output_key") or "output",
        "content": output.get("content") or "",
        "artifact": standard["artifact"],
        "source_refs": standard["source_refs"],
        "missing_information": standard["missing_information"],
        "confidence": standard["confidence"],
    }


def parse_json_object(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception:
        match = re.search(r"\{.*\}", raw or "", re.S)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                return None
    return None


def should_retry_with_more_context(node: dict[str, Any], output: dict[str, Any]) -> bool:
    node_type = runtime_node_type(str(node.get("type")), node.get("config") or {})
    return node_type in {"llm_call", "skill"} and bool(output.get("need_more_context")) and bool(output.get("retrieval_queries"))


def build_retry_info(output: dict[str, Any], material_store: dict[str, Any], context_package: dict[str, Any]) -> dict[str, Any]:
    queries = [str(item) for item in output.get("retrieval_queries") or [] if str(item).strip()]
    existing_ids = {item.get("chunk_id") for item in context_package.get("retrieved_material_chunks") or []}
    additional = []
    for query in queries:
        for chunk in retrieve_material_chunks(material_store, query, 8, 20000):
            if chunk.get("chunk_id") not in existing_ids:
                additional.append(chunk)
                existing_ids.add(chunk.get("chunk_id"))
    return {
        "enabled": True,
        "retry_reason": "need_more_context",
        "retrieval_queries": queries,
        "additional_chunks": additional,
        "retry_count": 0,
    }


def with_additional_chunks(context_package: dict[str, Any], chunks: list[dict[str, Any]]) -> dict[str, Any]:
    current = context_package.get("retrieved_material_chunks") or []
    updated = {**context_package, "retrieved_material_chunks": [*current, *chunks]}
    updated["source_refs"] = [
        {"source_id": item.get("source_id"), "chunk_id": item.get("chunk_id"), "reason": item.get("reason", "material_retrieval")}
        for item in updated["retrieved_material_chunks"]
    ]
    updated["is_context_sufficient"] = True
    return updated


def transfer_edge_output(edge: dict[str, Any], output: dict[str, Any], workflow_state: dict[str, Any]) -> Any:
    mode = edge.get("transfer_mode") or "full_output"
    condition = edge.get("condition")
    if mode == "condition_route" or condition:
        if isinstance(output, dict):
            routes = output.get("routed_outputs")
            if isinstance(routes, dict) and str(condition) in routes:
                return {"route_condition": str(condition), "routed_output": routes[str(condition)], "source_node_output": output}
    if mode == "artifact_only":
        source = str(edge.get("source"))
        return (workflow_state.get("artifacts") or {}).get(source, {}).get("artifact", output.get("artifact") if isinstance(output, dict) else output)
    if mode == "selected_paths":
        return select_paths_from_value({"output_json": output}, edge.get("selected_paths") or [], (workflow_state.get("global_warnings") if workflow_state else []))
    return output


def select_paths_from_value(value: Any, paths: list[Any], warnings: list[str]) -> dict[str, Any]:
    selected: dict[str, Any] = {}
    for item in paths:
        if isinstance(item, dict):
            from_path = str(item.get("from_path") or "")
            to_key = str(item.get("to_key") or from_path.split(".")[-1] or "value")
        else:
            from_path = str(item)
            to_key = from_path.split(".")[-1] or "value"
        found = get_path(value, from_path)
        if found is None:
            warnings.append(f"selected_path not found: {from_path}")
            continue
        selected[to_key] = found
    return selected


def get_path(value: Any, path: str) -> Any:
    current = value
    for part in path.split("."):
        if part in {"", "$"}:
            continue
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            index = int(part)
            current = current[index] if 0 <= index < len(current) else None
        else:
            return None
        if current is None:
            return None
    return current


def extract_code(content: str) -> str:
    match = re.search(r"```(?:python)?\s*(.*?)```", content, re.S | re.I)
    code = match.group(1).strip() if match else content.strip()
    if not code:
        code = "print('empty generated code')\n"
    return code


def assert_safe_command(command: str) -> None:
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, command, re.I):
            raise WorkflowExecutionError(f"Dangerous command rejected: {pattern}")
    args = shlex.split(command, posix=False)
    if not args:
        raise WorkflowExecutionError("Empty command")
    allowed = {"python", "python3", "py"}
    executable = Path(args[0]).name.lower()
    if executable not in allowed:
        raise WorkflowExecutionError("Only python execution is allowed in MVP")


def find_latest_by_key(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        for item_key, item_value in reversed(list(value.items())):
            if item_key == key:
                return item_value
            found = find_latest_by_key(item_value, key)
            if found is not None:
                return found
    if isinstance(value, list):
        for item in reversed(value):
            found = find_latest_by_key(item, key)
            if found is not None:
                return found
    return None


def evaluate_condition(config: dict[str, Any], upstream: dict[str, Any]) -> bool:
    field_path = config.get("field_path") or ""
    operator = config.get("operator") or "exists"
    expected = config.get("value")
    current: Any = upstream
    for part in field_path.split("."):
        if not part:
            continue
        if isinstance(current, dict):
            current = current.get(part)
        else:
            current = None
            break
    if operator == "exists":
        return current is not None
    if operator == "equals":
        return str(current) == str(expected)
    if operator == "contains":
        return str(expected) in str(current)
    return False
