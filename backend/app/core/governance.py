from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict


DEFAULT_GOVERNANCE: Dict[str, Dict[str, float]] = {
    "csi": {"stable_max": 0.10, "medium_max": 0.25},
    "psi_score": {"stable_max": 0.10, "medium_max": 0.25},
    "iv": {"significant_decline": -0.10, "weakened_decline": -0.03},
    "missing": {"flag_delta_pp": 5.0, "critical_delta_pp": 10.0},
    "performance": {
        "auc_material_drop_pp": 5.0,
        "auc_moderate_drop_pp": 2.0,
        "ks_material_drop_pp": 5.0,
    },
    "shap": {
        "jaccard_min": 0.80,
        "rank_shift_min_positions": 3.0,
        "mass_drop_pp": 5.0,
    },
}


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    out = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_governance(session: Dict[str, Any] | None) -> Dict[str, Any]:
    override = (session or {}).get("governance") or {}
    return _deep_merge(DEFAULT_GOVERNANCE, override)


def classify_band(value: float, stable_max: float, medium_max: float) -> str:
    if value >= medium_max:
        return "large"
    if value >= stable_max:
        return "medium"
    return "stable"


def classify_csi(value: float, governance: Dict[str, Any]) -> str:
    cfg = governance.get("csi", DEFAULT_GOVERNANCE["csi"])
    return classify_band(
        float(value),
        float(cfg.get("stable_max", 0.10)),
        float(cfg.get("medium_max", 0.25)),
    )


def classify_psi(value: float, governance: Dict[str, Any]) -> str:
    cfg = governance.get("psi_score", DEFAULT_GOVERNANCE["psi_score"])
    return classify_band(
        float(value),
        float(cfg.get("stable_max", 0.10)),
        float(cfg.get("medium_max", 0.25)),
    )


def classify_iv_delta(delta: float, governance: Dict[str, Any]) -> str:
    cfg = governance.get("iv", DEFAULT_GOVERNANCE["iv"])
    significant = float(cfg.get("significant_decline", -0.10))
    weakened = float(cfg.get("weakened_decline", -0.03))
    if delta <= significant:
        return "significant_decline"
    if delta <= weakened:
        return "weakened"
    if delta > 0.03:
        return "improved"
    return "stable"


def classify_missing_delta(delta_pp: float, governance: Dict[str, Any]) -> str:
    cfg = governance.get("missing", DEFAULT_GOVERNANCE["missing"])
    critical = float(cfg.get("critical_delta_pp", 10.0))
    moderate = float(cfg.get("flag_delta_pp", 5.0))
    magnitude = abs(float(delta_pp))
    if magnitude >= critical:
        return "critical"
    if magnitude >= moderate:
        return "moderate"
    return "stable"
