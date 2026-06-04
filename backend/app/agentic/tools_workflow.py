from __future__ import annotations

from typing import Any, Dict

from backend.app.agentic.tools import ToolRegistry, ToolSpec, passthrough_tool
from backend.app.utils.session import get_session


def build_default_registry() -> ToolRegistry:
    registry = ToolRegistry()
    for name in (
        "inventory_prepare",
        "ingestion_validate",
        "reproducibility_score",
        "recalibration_train",
        "evaluation_compare",
        "export_bundle",
    ):
        registry.register(
            ToolSpec(
                name=name,
                description=f"Delegated deterministic step for {name}.",
                input_schema={"type": "object"},
                output_schema={"type": "object"},
                idempotent=True,
                side_effects=False,
                fn=passthrough_tool,
            )
        )

    async def recommend_action(session_id: str, args: Dict[str, Any]) -> Dict[str, Any]:
        session = get_session(session_id) or {}
        signal = args.get("signal") or {}
        recommendation = args.get("recommendation") or {}
        return {
            "signal": signal,
            "recommendation": recommendation,
            "governance": session.get("governance") or {},
        }

    registry.register(
        ToolSpec(
            name="recommend_action",
            description="Create final drift action recommendation from deterministic signal grid.",
            input_schema={"type": "object"},
            output_schema={"type": "object"},
            idempotent=True,
            side_effects=False,
            fn=recommend_action,
        )
    )
    return registry
