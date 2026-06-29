import re
from pathlib import Path


SECRET_KEYS = re.compile(r"(api[_-]?key|authorization|cookie|password|secret|token)", re.I)
SK_PATTERN = re.compile(r"sk-[A-Za-z0-9_-]{8,}")


def mask_api_key(value: str | None) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return f"{value[:3]}-****{value[-4:]}" if value.startswith("sk-") else f"{value[:2]}****{value[-4:]}"


def sanitize_payload(value):
    if isinstance(value, str):
        return SK_PATTERN.sub("sk-****", value)
    if isinstance(value, list):
        return [sanitize_payload(item) for item in value]
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            if SECRET_KEYS.search(str(key)):
                cleaned[key] = "***"
            else:
                cleaned[key] = sanitize_payload(item)
        return cleaned
    return value


def safe_child_path(root: Path, *parts: str) -> Path:
    root_resolved = root.resolve()
    target = root_resolved.joinpath(*parts).resolve()
    if root_resolved != target and root_resolved not in target.parents:
        raise ValueError("Path escapes project workspace")
    return target
