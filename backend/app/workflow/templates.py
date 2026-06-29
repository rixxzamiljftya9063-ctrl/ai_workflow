from typing import Any


NODE_META = {
    "file_input": {"label": "文件输入", "color": "#2563eb"},
    "text_input": {"label": "文本输入", "color": "#0891b2"},
    "llm_call": {"label": "单模型调用", "color": "#7c3aed"},
    "parallel_llm": {"label": "多模型并行", "color": "#c026d3"},
    "cross_review": {"label": "交叉验证", "color": "#dc2626"},
    "merge": {"label": "合并", "color": "#475569"},
    "condition": {"label": "条件分支", "color": "#ca8a04"},
    "code_generation": {"label": "代码生成", "color": "#16a34a"},
    "code_execution": {"label": "代码执行", "color": "#15803d"},
    "result_validation": {"label": "结果校验", "color": "#0f766e"},
    "document_write": {"label": "文档撰写", "color": "#0369a1"},
    "compliance_check": {"label": "合规检查", "color": "#ea580c"},
    "export": {"label": "导出", "color": "#334155"},
}


def empty_workflow(name: str, workflow_id: int | str = "draft") -> dict[str, Any]:
    return {
        "id": str(workflow_id),
        "name": name,
        "version": "0.1.0",
        "nodes": [],
        "edges": [],
        "variables": {},
        "metadata": {},
    }


def _node(node_id: str, node_type: str, name: str, x: int, y: int, config: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": node_type,
        "name": name,
        "position": {"x": x, "y": y},
        "config": config,
        "inputs": [],
        "outputs": [],
    }


def _edge(source: str, target: str) -> dict[str, Any]:
    return {
        "id": f"edge-{source}-{target}",
        "source": source,
        "target": target,
        "source_handle": None,
        "target_handle": None,
        "condition": None,
    }


def modeling_template(provider_ids: list[int] | None = None) -> dict[str, Any]:
    providers = provider_ids or []
    main_provider = providers[0] if providers else None
    reviewer_ids = providers[:2]
    nodes = [
        _node("file_input_problem", "file_input", "赛题文件", 40, 80, {"file_id": None, "output_key": "problem_text"}),
        _node(
            "analyze_problem",
            "llm_call",
            "赛题分析",
            300,
            80,
            {
                "provider_id": main_provider,
                "prompt_template": "分析赛题，提取背景、问题、变量、约束、目标函数和数据输入。\n{{previous_output}}",
                "temperature": 0.4,
                "max_tokens": 1800,
                "input_mapping": {},
                "output_key": "analysis",
            },
        ),
        _node(
            "model_solution",
            "llm_call",
            "建模求解方案",
            560,
            80,
            {
                "provider_id": main_provider,
                "prompt_template": "基于赛题分析给出模型选择、变量定义、目标函数、约束、求解流程和代码路线。\n{{previous_output}}",
                "temperature": 0.4,
                "max_tokens": 1800,
                "input_mapping": {},
                "output_key": "solution",
            },
        ),
        _node(
            "parallel_branches",
            "parallel_llm",
            "多 API 分支",
            820,
            80,
            {
                "provider_ids": providers,
                "prompt_template": "请独立审视建模方案，指出不确定点、潜在错误和改进建议。\n{{previous_output}}",
                "output_key": "parallel_reviews",
            },
        ),
        _node(
            "cross_review",
            "cross_review",
            "交叉验证",
            1080,
            80,
            {
                "reviewer_provider_ids": reviewer_ids,
                "review_criteria": "检查遗漏、逻辑错误、约束冲突、路线可执行性，输出结构化 JSON。",
                "max_rounds": 1,
                "output_schema": "default",
            },
        ),
        _node(
            "code_generation",
            "code_generation",
            "编程实现",
            1340,
            80,
            {
                "provider_id": main_provider,
                "prompt_template": "生成可运行 Python 代码，读取上游结论并输出 result.txt。\n{{previous_output}}",
                "language": "python",
                "output_filename": "main.py",
            },
        ),
        _node(
            "code_execution",
            "code_execution",
            "代码运行",
            1600,
            80,
            {"command": "python main.py", "timeout_seconds": 10, "working_directory": "."},
        ),
        _node(
            "result_validation",
            "result_validation",
            "结果校验",
            1860,
            80,
            {"required_files": ["result.txt"], "check_stdout": True, "check_stderr": True},
        ),
        _node(
            "document_report",
            "document_write",
            "图表与论文撰写",
            2120,
            80,
            {
                "provider_id": main_provider,
                "document_type": "math_modeling_report",
                "prompt_template": "基于上游真实输出撰写 Markdown 数学建模报告，不编造数据。\n{{previous_output}}",
                "output_filename": "math_modeling_report.md",
            },
        ),
        _node(
            "compliance_check",
            "compliance_check",
            "编译与合规检查",
            2380,
            80,
            {
                "provider_id": main_provider,
                "checklist": [
                    "是否有摘要",
                    "是否有问题重述",
                    "是否有模型假设",
                    "是否有符号说明",
                    "是否有求解过程",
                    "是否存在待补充等占位文本",
                ],
                "pass_condition": "no_blocking_issues",
            },
        ),
        _node("export_result", "export", "导出", 2640, 80, {"export_format": "json", "output_filename": "workflow_output.json"}),
    ]
    edges = [_edge(nodes[index]["id"], nodes[index + 1]["id"]) for index in range(len(nodes) - 1)]
    return {
        "id": "math-modeling-template",
        "name": "数学建模多模型交叉验证工作流",
        "version": "0.1.0",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "metadata": {"template": "math_modeling_cross_review"},
    }
