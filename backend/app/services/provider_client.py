import json
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.models.entities import ApiProvider


@dataclass
class ProviderResult:
    status: str
    content: str
    raw: dict[str, Any] | str | None = None
    error: str | None = None
    request_url: str | None = None
    status_code: int | None = None
    duration_ms: int | None = None
    provider_name: str | None = None
    model_name: str | None = None


class ProviderClient:
    def __init__(self, timeout_seconds: int = 180):
        self.timeout_seconds = timeout_seconds

    async def complete(self, provider: ApiProvider, prompt: str, system_prompt: str = "") -> ProviderResult:
        if not provider.enabled:
            return ProviderResult(status="error", content="", error="Provider is disabled")
        if provider.provider_type == "mock":
            return ProviderResult(status="success", content=self._mock_response(provider, prompt), raw={"mock": True})
        if provider.provider_type == "anthropic":
            return ProviderResult(status="error", content="", error="Anthropic provider is reserved but not fully supported in MVP")
        if provider.provider_type in {"openai_compatible", "deepseek", "custom"}:
            return await self._openai_compatible(provider, prompt, system_prompt)
        return ProviderResult(status="error", content="", error=f"Unsupported provider type: {provider.provider_type}")

    async def chat(self, provider: ApiProvider, message: str, history: list[dict[str, str]] | None = None, system_prompt: str = "") -> ProviderResult:
        if not provider.enabled:
            return ProviderResult(status="error", content="", error="Provider is disabled", provider_name=provider.name, model_name=provider.model_name)
        history = history or []
        if provider.provider_type == "mock":
            return ProviderResult(
                status="success",
                content=self._mock_chat_response(provider, message, history),
                raw={"mock": True, "history_count": len(history)},
                duration_ms=0,
                provider_name=provider.name,
                model_name=provider.model_name,
            )
        if provider.provider_type == "anthropic":
            return ProviderResult(status="error", content="", error="Anthropic provider is reserved but not fully supported in MVP", provider_name=provider.name, model_name=provider.model_name)
        if provider.provider_type in {"openai_compatible", "deepseek", "custom"}:
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            for item in history[-20:]:
                role = item.get("role")
                content = item.get("content")
                if role in {"user", "assistant", "system"} and content:
                    messages.append({"role": role, "content": str(content)})
            messages.append({"role": "user", "content": message})
            return await self._openai_compatible_messages(provider, messages)
        return ProviderResult(status="error", content="", error=f"Unsupported provider type: {provider.provider_type}", provider_name=provider.name, model_name=provider.model_name)

    async def test(self, provider: ApiProvider) -> ProviderResult:
        if provider.provider_type == "mock":
            return ProviderResult(
                status="success",
                content="Mock provider is ready. 输出: provider test ok",
                raw={"mock": True, "test_prompt": "Return the text: provider test ok"},
                duration_ms=0,
                provider_name=provider.name,
                model_name=provider.model_name,
            )
        result = await self.complete(provider, "Return exactly one short sentence: provider test ok")
        result.provider_name = provider.name
        result.model_name = provider.model_name
        return result

    async def _openai_compatible(self, provider: ApiProvider, prompt: str, system_prompt: str) -> ProviderResult:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        return await self._openai_compatible_messages(provider, messages)

    async def _openai_compatible_messages(self, provider: ApiProvider, messages: list[dict[str, str]]) -> ProviderResult:
        if not provider.base_url:
            return ProviderResult(status="error", content="", error="base_url is required")
        if not provider.api_key:
            return ProviderResult(status="error", content="", error="api_key is required")
        url = self._chat_completions_url(provider.base_url)
        payload = {
            "model": provider.model_name or "gpt-4o-mini",
            "messages": messages,
            "temperature": provider.temperature,
            "max_tokens": provider.max_tokens,
        }
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(url, json=payload, headers={"Authorization": f"Bearer {provider.api_key}"})
            duration_ms = int((time.perf_counter() - started) * 1000)
            body_text = response.text
            if response.status_code >= 400:
                return ProviderResult(
                    status="error",
                    content="",
                    raw=self._safe_response_body(body_text),
                    error=f"HTTP {response.status_code} {response.reason_phrase}",
                    request_url=url,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                    provider_name=provider.name,
                    model_name=provider.model_name,
                )
            try:
                parsed = response.json()
            except json.JSONDecodeError:
                return ProviderResult(
                    status="error",
                    content="",
                    raw=self._safe_response_body(body_text),
                    error="Response is not valid JSON. Check whether Base URL is an OpenAI-compatible endpoint, usually ending with /v1.",
                    request_url=url,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                    provider_name=provider.name,
                    model_name=provider.model_name,
                )
            content = parsed.get("choices", [{}])[0].get("message", {}).get("content", "")
            if not content:
                return ProviderResult(
                    status="error",
                    content="",
                    raw=parsed,
                    error="Response JSON does not contain choices[0].message.content.",
                    request_url=url,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                    provider_name=provider.name,
                    model_name=provider.model_name,
                )
            return ProviderResult(
                status="success",
                content=content,
                raw=parsed,
                request_url=url,
                status_code=response.status_code,
                duration_ms=duration_ms,
                provider_name=provider.name,
                model_name=provider.model_name,
            )
        except httpx.TimeoutException as exc:
            return ProviderResult(
                status="error",
                content="",
                error=f"请求中转站超时，已等待 {self.timeout_seconds} 秒：{exc}",
                request_url=url,
                duration_ms=int((time.perf_counter() - started) * 1000),
                provider_name=provider.name,
                model_name=provider.model_name,
            )
        except httpx.RequestError as exc:
            return ProviderResult(
                status="error",
                content="",
                error=f"Request failed: {exc}",
                request_url=url,
                duration_ms=int((time.perf_counter() - started) * 1000),
                provider_name=provider.name,
                model_name=provider.model_name,
            )
        except Exception as exc:
            return ProviderResult(
                status="error",
                content="",
                error=f"Provider test failed: {exc}",
                request_url=url,
                duration_ms=int((time.perf_counter() - started) * 1000),
                provider_name=provider.name,
                model_name=provider.model_name,
            )

    def _chat_completions_url(self, base_url: str) -> str:
        base = base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        if base.endswith("/v1"):
            return f"{base}/chat/completions"
        return f"{base}/v1/chat/completions"

    def _safe_response_body(self, body: str) -> str:
        text = body.strip()
        if not text:
            return "<empty response body>"
        return text[:2000]

    def _mock_response(self, provider: ApiProvider, prompt: str) -> str:
        lower = prompt.lower()
        if "mock_need_more_context" in lower and "补充上下文后的重试" not in prompt:
            return json.dumps(
                {
                    "need_more_context": True,
                    "retrieval_queries": ["核心方法", "实验结果"],
                    "missing_information": ["需要更多项目资料片段"],
                    "content": "第一次 mock 调用主动请求补充上下文。",
                    "confidence": "low",
                },
                ensure_ascii=False,
            )
        if "mock_need_more_context" in lower and "补充上下文后的重试" in prompt:
            return json.dumps(
                {
                    "need_more_context": False,
                    "retrieval_queries": [],
                    "missing_information": [],
                    "artifact": {"text": "补充上下文后生成的最终 mock 结果。"},
                    "content": "补充上下文后生成的最终 mock 结果。",
                    "confidence": "medium",
                },
                ensure_ascii=False,
            )
        if "cross_review_schema" in lower or "agreement_points" in lower and "risk_level" in lower:
            agreement = ["Mock reviewers agree the workflow has a clear input-analysis-output path."]
            conflict = ["Reviewer A prefers a simpler model, while Reviewer B asks for stronger validation."]
            missing = ["Real competition data constraints should be checked before final submission."]
            logic_error: list[str] = []
            risk = {"risk_level": "medium", "reason": "Validation is still needed before accepting the result."}
            revision_tasks = ["Add data assumptions.", "Run code validation before accepting conclusions."]
            return json.dumps(
                {
                    "agreement_points": agreement,
                    "conflict_points": conflict,
                    "missing_constraints": missing,
                    "logic_errors": logic_error,
                    "risk_level": "medium",
                    "recommended_action": "revise",
                    "revision_instructions": revision_tasks,
                    "final_summary": "Mock cross review completed with structured findings.",
                    "raw_reviews": [{"provider": provider.name, "content": "Mock structured review"}],
                    "agreement": agreement,
                    "conflict": conflict,
                    "missing": missing,
                    "logic_error": logic_error,
                    "risk": risk,
                    "revision_tasks": revision_tasks,
                    "routed_outputs": {
                        "agreement": agreement,
                        "conflict": conflict,
                        "missing": missing,
                        "logic_error": logic_error,
                        "risk": risk,
                        "revision_tasks": revision_tasks,
                    },
                },
                ensure_ascii=False,
            )
        wants_code = (
            "generate python" in lower
            or "python code" in lower
            or "```python" in lower
            or "生成可运行 python" in lower
            or "生成 python 代码" in lower
            or "生成可运行 Python" in prompt
        )
        if wants_code:
            return (
                "```python\n"
                "from pathlib import Path\n"
                "print('AI Workflow Builder mock execution ok')\n"
                "Path('result.txt').write_text('mock result generated', encoding='utf-8')\n"
                "```\n"
            )
        if "markdown" in lower or "document" in lower or "论文" in prompt or "报告" in prompt:
            return "# Mock Markdown Report\n\n## Summary\n\nThis report was generated by the mock provider.\n\n## Result\n\nThe workflow completed successfully.\n"
        return f"Mock response from {provider.name or 'provider'} for prompt:\n{prompt[:1200]}"

    def _mock_chat_response(self, provider: ApiProvider, message: str, history: list[dict[str, str]]) -> str:
        user_turns = len([item for item in history if item.get("role") == "user"])
        return (
            f"Mock chat reply from {provider.name or 'provider'}.\n\n"
            f"已收到第 {user_turns + 1} 条用户消息：{message}\n\n"
            "这个回复来自画布中的对话窗口，可继续追问，也可以把该对话节点连接到后续工作流节点。"
        )
