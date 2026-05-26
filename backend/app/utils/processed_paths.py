"""Paths and persistence for scored processed datasets under backend/data/processed_data."""
from __future__ import annotations

import os
from typing import Any, Dict, Literal, Optional

import numpy as np
import pandas as pd

DatasetKind = Literal["dev", "new", "hold", "oot"]

_DATASET_BASENAME = {
    "dev": "processed_dev",
    "new": "processed_new",
    "hold": "processed_hold",
    "oot": "processed_oot",
}


def backend_data_dir() -> str:
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")


def processed_data_dir() -> str:
    path = os.path.join(backend_data_dir(), "processed_data")
    os.makedirs(path, exist_ok=True)
    return path


def artifact_basename(session_id: str, dataset: DatasetKind) -> str:
    return f"{session_id}_{_DATASET_BASENAME[dataset]}"


def processed_parquet_path(session_id: str, dataset: DatasetKind) -> str:
    return os.path.join(processed_data_dir(), f"{artifact_basename(session_id, dataset)}.parquet")


def processed_csv_path(session_id: str, dataset: DatasetKind) -> str:
    return os.path.join(processed_data_dir(), f"{artifact_basename(session_id, dataset)}.csv")


def score_comparison_path(session_id: str, dataset: str = "dev") -> str:
    return os.path.join(processed_data_dir(), f"{session_id}_score_comparison_{dataset}.csv")


def ensure_prediction_columns(
    df: pd.DataFrame,
    *,
    new_scores: Optional[np.ndarray] = None,
) -> pd.DataFrame:
    out = df.copy()
    if "score" in out.columns:
        out["score"] = pd.to_numeric(out["score"], errors="coerce")
        if "predicted_proba" not in out.columns:
            out["predicted_proba"] = out["score"]
    if new_scores is not None and len(new_scores) == len(out):
        recal = np.asarray(new_scores, dtype=float)
        out["new_score"] = recal
        out["predicted_proba"] = recal
    return out


def _write_parquet_safe(df: pd.DataFrame, path: str) -> None:
    try:
        df.to_parquet(path, index=False)
    except Exception:
        safe = df.copy()
        for col in safe.select_dtypes(include=["object"]).columns:
            safe[col] = safe[col].astype(str)
        safe.to_parquet(path, index=False)


def persist_processed_dataset(
    df: pd.DataFrame,
    session_id: str,
    dataset: DatasetKind,
    *,
    new_scores: Optional[np.ndarray] = None,
) -> Dict[str, str]:
    """Write parquet + CSV with score / predicted_proba (and optional new_score)."""
    processed_data_dir()
    out = ensure_prediction_columns(df, new_scores=new_scores)
    parquet_path = processed_parquet_path(session_id, dataset)
    csv_path = processed_csv_path(session_id, dataset)
    _write_parquet_safe(out, parquet_path)
    out.to_csv(csv_path, index=False)
    return {"parquet": parquet_path, "csv": csv_path}


def export_paths_payload(session_id: str, datasets: list[DatasetKind]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"directory": processed_data_dir()}
    for ds in datasets:
        payload[ds] = {
            "parquet": processed_parquet_path(session_id, ds),
            "csv": processed_csv_path(session_id, ds),
        }
    return payload
