"""Load model registry from llm_model_mapping.json and merge env overrides."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.app.core.config import LitellmUsageConfig, _normalize_bedrock_model

_REGISTRY_PATH = Path(__file__).resolve().parent.parent / "config" / "llm_model_mapping.json"
_CACHE: Optional[Dict[str, Any]] = None


def _registry_path() -> Path:
    override = os.getenv("LLM_MODEL_MAPPING_PATH")
    if override:
        return Path(override)
    return _REGISTRY_PATH


def load_registry(*, force_reload: bool = False) -> Dict[str, Any]:
    global _CACHE
    if _CACHE is not None and not force_reload:
        return _CACHE
    path = _registry_path()
    if not path.is_file():
        _CACHE = {"chat": {}, "embedding": {}}
        return _CACHE
    with path.open(encoding="utf-8") as fh:
        _CACHE = json.load(fh)
    return _CACHE


def list_models(usage: str = "chat") -> List[str]:
    registry = load_registry()
    section = registry.get(usage, {})
    if not isinstance(section, dict):
        return []
    return sorted(section.keys())


def resolve_model_config(
    model_id: str,
    usage: str = "chat",
) -> Optional[LitellmUsageConfig]:
    """Resolve a registry model id to LitellmUsageConfig."""
    registry = load_registry()
    section = registry.get(usage, {})
    if not isinstance(section, dict):
        return None
    entry = section.get(model_id)
    if not entry or not isinstance(entry, dict):
        return None
    merged = dict(entry)
    merged.setdefault("model", model_id)
    return LitellmUsageConfig.from_mapping(
        name=model_id,
        usage_type=usage,
        model_id=model_id,
        mapping=merged,
        model_normalizer=_normalize_bedrock_model,
    )


def models_with_tag(tag: str, usage: str = "chat") -> List[str]:
    registry = load_registry()
    section = registry.get(usage, {})
    if not isinstance(section, dict):
        return []
    out: List[str] = []
    for model_id, entry in section.items():
        if not isinstance(entry, dict):
            continue
        tags = entry.get("tags") or []
        if tag in tags:
            out.append(model_id)
    return out
