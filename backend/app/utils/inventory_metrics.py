"""Map inventory configuration labels to evaluation / diagnostics metric sets."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Set

PERFORMANCE_CLASSIFICATION = frozenset(
    {"AUC", "KS", "GINI", "Calibration", "Lift/Gains", "Feature Importance"}
)
PERFORMANCE_REGRESSION = frozenset({"RMSE", "MAE", "R2"})


def _problem_type(session: Dict[str, Any]) -> str:
    entry = session.get("model_entry") or {}
    raw = str(entry.get("problem_type") or "classification").lower()
    return "regression" if raw.startswith("reg") else "classification"


def requested_inventory_metrics(session: Dict[str, Any]) -> Set[str]:
    raw = session.get("evaluation_metrics") or session.get("drift_metrics") or []
    if isinstance(raw, str):
        return {raw}
    return {str(x) for x in raw if x}


def performance_metrics_for_session(session: Dict[str, Any]) -> List[str]:
    selected = requested_inventory_metrics(session)
    allowed = (
        PERFORMANCE_REGRESSION
        if _problem_type(session) == "regression"
        else PERFORMANCE_CLASSIFICATION
    )
    return sorted(m for m in selected if m in allowed)


def require_performance_metrics(session: Dict[str, Any]) -> List[str]:
    metrics = performance_metrics_for_session(session)
    if not metrics:
        raise ValueError(
            "No performance metrics selected in inventory for this model. "
            "Select metrics on the Inventory page and restart the workflow."
        )
    return metrics


def wants_feature_importance(session: Dict[str, Any]) -> bool:
    return "Feature Importance" in requested_inventory_metrics(session)
