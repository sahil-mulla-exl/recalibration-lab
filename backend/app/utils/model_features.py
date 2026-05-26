"""Resolve model feature names from uploaded .pkl / reproducibility session state."""

from __future__ import annotations

import os
from typing import Any, Dict, Iterable, List, Optional, Sequence

import pandas as pd

from backend.app.utils.model_helpers import extract_model_feature_names, load_model

NON_FEATURE_COLUMNS = frozenset({
    "score",
    "new_score",
    "predicted_outcome",
    "predicted_proba",
})


def load_model_feature_names_from_session(session: Dict[str, Any]) -> List[str]:
    """
    Return feature names from reproducibility output, session cache, or live .pkl.
    Order preserved; no hardcoded demo feature list.
    """
    repro = session.get("reproducibility_result") or {}
    if isinstance(repro.get("model_features_used"), list):
        names = [str(c) for c in repro["model_features_used"] if str(c).strip()]
        if names:
            return names

    cached = session.get("uploaded_model_feature_names")
    if isinstance(cached, list):
        names = [str(c) for c in cached if str(c).strip()]
        if names:
            return names

    model_path = session.get("model_path")
    if model_path and os.path.exists(model_path):
        try:
            names = extract_model_feature_names(load_model(model_path))
            return [str(c) for c in names if str(c).strip()]
        except Exception:
            return []
    return []


def intersect_model_features_with_columns(
    feature_names: Sequence[str],
    *frames: pd.DataFrame,
) -> List[str]:
    """Keep model feature order; only names present in all provided frames."""
    if not feature_names:
        return []
    common: set[str] | None = None
    for frame in frames:
        cols = set(frame.columns)
        common = cols if common is None else common & cols
    available = common or set()
    return [f for f in feature_names if f in available]


def resolve_session_model_features(
    session: Dict[str, Any],
    *frames: pd.DataFrame,
    exclude: Optional[Iterable[str]] = None,
) -> List[str]:
    """
    Model features from .pkl only, optionally filtered to columns in ``frames``.
    Raises ValueError when the model exposes no feature names.
    """
    names = load_model_feature_names_from_session(session)
    if not names:
        raise ValueError(
            "No feature names found on the uploaded model (.pkl). "
            "Upload a champion model and complete data processing before continuing."
        )

    if frames:
        cols = intersect_model_features_with_columns(names, *frames)
        if not cols:
            raise ValueError(
                "Uploaded model features do not match dataset columns. "
                "Re-run data processing after uploading the correct .pkl."
            )
    else:
        cols = list(names)

    excluded = NON_FEATURE_COLUMNS | {str(c) for c in (exclude or []) if c}
    filtered = [c for c in cols if c not in excluded]
    if not filtered:
        raise ValueError("No model features remain after excluding targets and scores.")
    return filtered


def persist_uploaded_model_feature_names(session_id: str, names: List[str]) -> None:
    from backend.app.utils.session import update_session

    update_session(session_id, {"uploaded_model_feature_names": names})
