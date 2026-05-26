"""Per-context prompt generation parameters (max_tokens, temperature)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, Optional

_ENV_PREFIX = "LLM_PROFILE"


@dataclass(frozen=True)
class LLMPromptProfile:
    max_tokens: int
    temperature: float
    description: str = ""


_DEFAULT_PROFILES: Dict[str, LLMPromptProfile] = {
    "default_chat": LLMPromptProfile(1024, 0.3, "General assistant replies"),
    "data_processing": LLMPromptProfile(800, 0.2, "Data processing step explanations"),
    "drift_diagnostics": LLMPromptProfile(1200, 0.25, "Drift narrative and PSI interpretation"),
    "recalibration": LLMPromptProfile(900, 0.25, "Recalibration run summaries"),
    "evaluation": LLMPromptProfile(900, 0.25, "Metric comparison and evaluation insights"),
    "export_mrm": LLMPromptProfile(1500, 0.2, "MRM export narrative"),
    "root_cause": LLMPromptProfile(1200, 0.3, "Root-cause attribution summaries"),
    "policy_guardrails": LLMPromptProfile(600, 0.1, "Policy / guardrail explanations"),
    "model_training": LLMPromptProfile(900, 0.25, "Cross-algorithm / hyperparameter style guidance"),
}


def _env_override(context: str, field: str, default: float | int) -> float | int:
    key = f"{_ENV_PREFIX}_{context.upper()}_{field.upper()}"
    raw = os.getenv(key)
    if raw is None or not str(raw).strip():
        return default
    try:
        if field == "max_tokens":
            return int(raw)
        return float(raw)
    except ValueError:
        return default


def get_prompt_profile(context: str) -> LLMPromptProfile:
    base = _DEFAULT_PROFILES.get(context) or _DEFAULT_PROFILES["default_chat"]
    max_tokens = int(_env_override(context, "max_tokens", base.max_tokens))
    temperature = float(_env_override(context, "temperature", base.temperature))
    return LLMPromptProfile(
        max_tokens=max_tokens,
        temperature=temperature,
        description=base.description,
    )


def list_prompt_contexts() -> list[str]:
    return sorted(_DEFAULT_PROFILES.keys())
