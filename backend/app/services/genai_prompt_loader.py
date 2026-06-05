"""Load GenAI system prompts from backend/app/config/genai_prompts/."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "config" / "genai_prompts"
_MANIFEST_NAME = "prompts_manifest.json"


def prompts_dir() -> Path:
    override = os.getenv("GENAI_PROMPTS_DIR")
    if override:
        return Path(override)
    return _PROMPTS_DIR


@lru_cache(maxsize=1)
def load_manifest() -> Dict[str, Any]:
    path = prompts_dir() / _MANIFEST_NAME
    if not path.is_file():
        return {"version": 0, "prompts": {}}
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def list_prompt_ids() -> List[str]:
    manifest = load_manifest()
    prompts = manifest.get("prompts", {})
    if not isinstance(prompts, dict):
        return []
    return sorted(prompts.keys())


def get_prompt_meta(prompt_id: str) -> Dict[str, Any]:
    manifest = load_manifest()
    prompts = manifest.get("prompts", {})
    if not isinstance(prompts, dict) or prompt_id not in prompts:
        raise KeyError(f"Unknown GenAI prompt id: {prompt_id}")
    meta = prompts[prompt_id]
    if not isinstance(meta, dict):
        raise KeyError(f"Invalid manifest entry for prompt id: {prompt_id}")
    return meta


def load_system_prompt(prompt_id: str) -> str:
    """Return the markdown system prompt for a manifest prompt id."""
    meta = get_prompt_meta(prompt_id)
    filename = str(meta.get("file") or "").strip()
    if not filename:
        raise ValueError(f"Manifest entry for {prompt_id} is missing 'file'")
    path = prompts_dir() / filename
    if not path.is_file():
        raise FileNotFoundError(f"GenAI prompt file not found: {path}")
    return path.read_text(encoding="utf-8").strip()


def get_llm_context(prompt_id: str) -> str:
    meta = get_prompt_meta(prompt_id)
    return str(meta.get("llm_context") or "default_chat")
