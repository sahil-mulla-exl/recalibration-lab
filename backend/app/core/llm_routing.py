"""Context-based LLM routing policies (no API layer)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from backend.app.core.llm_registry import models_with_tag, resolve_model_config


@dataclass(frozen=True)
class LLMRoutingPolicy:
    """Which models to try for a workflow context."""

    context: str
    default_model: str
    fallback_models: List[str] = field(default_factory=list)
    preferred_tags: List[str] = field(default_factory=list)
    usage: str = "chat"


# Recalibration Lab workflow contexts — align with future agent narrative hooks.
POLICIES: dict[str, LLMRoutingPolicy] = {
    "default_chat": LLMRoutingPolicy(
        context="default_chat",
        default_model="gpt-4.1-mini",
        fallback_models=["claude-haiku-4-5"],
        preferred_tags=["fast"],
    ),
    "data_processing": LLMRoutingPolicy(
        context="data_processing",
        default_model="gpt-4.1-mini",
        fallback_models=["claude-haiku-4-5"],
        preferred_tags=["fast", "cheap"],
    ),
    "drift_diagnostics": LLMRoutingPolicy(
        context="drift_diagnostics",
        default_model="gpt-4.1-mini",
        fallback_models=["claude-sonnet-4-5"],
        preferred_tags=["fast"],
    ),
    "recalibration": LLMRoutingPolicy(
        context="recalibration",
        default_model="gpt-4.1-mini",
        fallback_models=["claude-sonnet-4-5"],
        preferred_tags=["reasoning"],
    ),
    "evaluation": LLMRoutingPolicy(
        context="evaluation",
        default_model="claude-haiku-4-5",
        fallback_models=["gpt-4.1-mini"],
        preferred_tags=["fast"],
    ),
    "export_mrm": LLMRoutingPolicy(
        context="export_mrm",
        default_model="claude-sonnet-4-5",
        fallback_models=["gpt-4.1"],
        preferred_tags=["quality"],
    ),
    "root_cause": LLMRoutingPolicy(
        context="root_cause",
        default_model="claude-sonnet-4-5",
        fallback_models=["gpt-4.1"],
        preferred_tags=["reasoning"],
    ),
    "policy_guardrails": LLMRoutingPolicy(
        context="policy_guardrails",
        default_model="gpt-4.1-mini",
        fallback_models=["claude-haiku-4-5"],
        preferred_tags=["fast", "cheap"],
    ),
    # MIDAS-compatible alias for cross-algorithm style recommendations
    "model_training": LLMRoutingPolicy(
        context="model_training",
        default_model="claude-haiku-4-5",
        fallback_models=["gpt-4.1-mini"],
        preferred_tags=["fast"],
    ),
}


def policy_for(context: str) -> LLMRoutingPolicy:
    return POLICIES.get(context) or POLICIES["default_chat"]


def candidates_for(context: str) -> List[str]:
    """Ordered model ids to try for a context."""
    policy = policy_for(context)
    seen: set[str] = set()
    ordered: List[str] = []

    def _add(model_id: Optional[str]) -> None:
        if not model_id or model_id in seen:
            return
        if resolve_model_config(model_id, usage=policy.usage) is None:
            return
        seen.add(model_id)
        ordered.append(model_id)

    _add(policy.default_model)
    for tag in policy.preferred_tags:
        for model_id in models_with_tag(tag, usage=policy.usage):
            _add(model_id)
    for model_id in policy.fallback_models:
        _add(model_id)
    return ordered
