from __future__ import annotations

from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.inspection import partial_dependence
import warnings


def _normalize_importance(importance: Dict[str, float]) -> Dict[str, float]:
    total = max(float(sum(abs(v) for v in importance.values())), 1e-9)
    return {k: float(abs(v) / total) for k, v in importance.items()}


def _safe_predict(model: Any, frame: pd.DataFrame) -> np.ndarray:
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(frame)
        if isinstance(proba, np.ndarray) and proba.ndim == 2 and proba.shape[1] > 1:
            return np.asarray(proba[:, 1], dtype=float)
    return np.asarray(model.predict(frame), dtype=float)


def compute_shap_importance(
    model: Any,
    frame: pd.DataFrame,
    max_samples: int = 2000,
    seed: int = 42,
) -> Dict[str, float]:
    if frame.empty:
        return {}
    sampled = frame.sample(n=min(max_samples, len(frame)), random_state=seed) if len(frame) > max_samples else frame
    def _fallback_importance() -> Dict[str, float]:
        if hasattr(model, "feature_importances_"):
            arr = np.asarray(getattr(model, "feature_importances_"), dtype=float)
        elif hasattr(model, "coef_"):
            coef = np.asarray(getattr(model, "coef_"), dtype=float)
            arr = np.abs(coef.reshape(-1))
        else:
            return {}
        if arr.size == 0:
            return {}
        arr = arr[: len(sampled.columns)]
        return {str(col): float(val) for col, val in zip(sampled.columns, arr)}

    try:
        import shap  # type: ignore
    except Exception:
        return _fallback_importance()

    try:
        explainer = shap.Explainer(model, sampled, seed=seed)
        values = explainer(sampled)
        arr = values.values
        if arr.ndim == 3:
            arr = arr[:, :, -1]
        mean_abs = np.abs(arr).mean(axis=0)
        return {str(col): float(val) for col, val in zip(sampled.columns, mean_abs)}
    except Exception:
        return _fallback_importance()


def compute_pdp_for_all_features(
    model: Any,
    frame: pd.DataFrame,
    features: List[str],
    n_grid: int = 10,
) -> Dict[str, Dict[str, List[float]]]:
    results: Dict[str, Dict[str, List[float]]] = {}
    if frame.empty:
        return results
    sampled = frame.sample(n=min(len(frame), 1500), random_state=42) if len(frame) > 1500 else frame
    sampled = sampled.copy()
    for col in sampled.columns:
        sampled[col] = pd.to_numeric(sampled[col], errors="coerce").fillna(0.0).astype(float)
    for feature in features:
        if feature not in sampled.columns:
            continue
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=FutureWarning, module="sklearn.inspection._partial_dependence")
                pdp = partial_dependence(
                    model,
                    sampled,
                    [feature],
                    kind="average",
                    grid_resolution=max(5, n_grid),
                )
            grid = pdp["grid_values"][0]
            avg = pdp["average"][0]
            results[feature] = {
                "x": [float(v) for v in np.asarray(grid)],
                "y": [float(v) for v in np.asarray(avg)],
            }
        except Exception:
            results[feature] = {"x": [], "y": []}
    return results


def compute_shap_shift_flags(
    dev_importance: Dict[str, float],
    new_importance: Dict[str, float],
    top_k: int,
    feature_set_overlap_min: float,
    rank_shift_min_positions: int,
    mass_drop_pp: float,
) -> Dict[str, Any]:
    dev_norm = _normalize_importance(dev_importance)
    new_norm = _normalize_importance(new_importance)

    dev_rank = sorted(dev_norm.items(), key=lambda kv: kv[1], reverse=True)
    new_rank = sorted(new_norm.items(), key=lambda kv: kv[1], reverse=True)
    dev_top = [k for k, _ in dev_rank[:top_k]]
    new_top = [k for k, _ in new_rank[:top_k]]
    dev_set = set(dev_top)
    new_set = set(new_top)
    union = max(len(dev_set | new_set), 1)
    feature_set_overlap = float(len(dev_set & new_set) / union)

    new_positions = {name: idx for idx, (name, _) in enumerate(new_rank)}
    shifts = []
    for idx, name in enumerate(dev_top):
        new_idx = new_positions.get(name, top_k + 10)
        shifts.append(abs(new_idx - idx))
    major_shift = int(sum(1 for s in shifts if s >= rank_shift_min_positions))

    dev_mass = float(sum(dev_norm.get(f, 0.0) for f in dev_top) * 100.0)
    new_mass = float(sum(new_norm.get(f, 0.0) for f in new_top) * 100.0)
    mass_delta_pp = new_mass - dev_mass

    breaches = 0
    if feature_set_overlap < feature_set_overlap_min:
        breaches += 1
    if major_shift > 0:
        breaches += 1
    if mass_delta_pp <= -abs(mass_drop_pp):
        breaches += 1
    composite = "action" if breaches >= 2 else ("watch" if breaches == 1 else "stable")

    return {
        "feature_set_overlap": feature_set_overlap,
        "major_rank_shifts": major_shift,
        "topk_mass_dev_pct": dev_mass,
        "topk_mass_new_pct": new_mass,
        "topk_mass_delta_pp": mass_delta_pp,
        "composite": composite,
    }
