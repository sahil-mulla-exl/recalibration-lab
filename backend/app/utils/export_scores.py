"""Helpers for exporting scores and comparing to external reference predictions."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

import numpy as np
import pandas as pd

from backend.app.utils.data_io import read_tabular_dataframe

DEFAULT_REFERENCE_PREDICTIONS = os.getenv(
    "REFERENCE_PREDICTIONS_CSV",
    r"C:\Users\Sahil338946\Downloads\Final_Input_For_Developer\raw_production_data_w_predictions.csv",
)

JOIN_KEYS = ("id", "member_id", "loan_amnt")


def ensure_predicted_proba(df: pd.DataFrame, score_col: str = "score") -> pd.DataFrame:
    out = df.copy()
    if score_col in out.columns and "predicted_proba" not in out.columns:
        out["predicted_proba"] = pd.to_numeric(out[score_col], errors="coerce")
    return out


def _read_table(path: str) -> pd.DataFrame:
    if path.lower().endswith(".parquet"):
        return pd.read_parquet(path)
    return read_tabular_dataframe(path)


def _pick_join_key(left: pd.DataFrame, right: pd.DataFrame) -> Optional[str]:
    for key in JOIN_KEYS:
        if key in left.columns and key in right.columns:
            return key
    return None


def build_score_comparison(
    platform_path: str,
    reference_path: str,
    platform_score_col: str = "score",
    reference_score_col: str = "predicted_proba",
    join_key: Optional[str] = None,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    platform_df = ensure_predicted_proba(_read_table(platform_path), platform_score_col)
    ref_df = _read_table(reference_path)

    if reference_score_col not in ref_df.columns:
        raise ValueError(f"Reference file missing column: {reference_score_col}")
    if platform_score_col not in platform_df.columns:
        raise ValueError(f"Platform file missing column: {platform_score_col}")

    key = join_key or _pick_join_key(platform_df, ref_df)
    if key:
        plat_cols = [key, platform_score_col, "predicted_proba"]
        if "target_flag" in platform_df.columns:
            plat_cols.append("target_flag")
        plat_sub = platform_df[[c for c in plat_cols if c in platform_df.columns]].copy()
        ref_sub = ref_df[[key, reference_score_col]].copy()
        ref_sub = ref_sub.rename(columns={reference_score_col: "reference_predicted_proba"})
        merged = plat_sub.merge(ref_sub, on=key, how="inner")
        ref_col = "reference_predicted_proba"
    else:
        if len(platform_df) != len(ref_df):
            raise ValueError(
                "No common join key and row counts differ — cannot align by row order."
            )
        merged = pd.DataFrame({
            "row_index": np.arange(len(platform_df)),
            platform_score_col: pd.to_numeric(platform_df[platform_score_col], errors="coerce"),
            reference_score_col: pd.to_numeric(ref_df[reference_score_col], errors="coerce"),
        })
        if "predicted_proba" in platform_df.columns:
            merged["predicted_proba"] = platform_df["predicted_proba"].values
        if "target_flag" in platform_df.columns:
            merged["target_flag"] = platform_df["target_flag"].values
        ref_col = reference_score_col
        key = "row_index"

    plat_scores = pd.to_numeric(merged[platform_score_col], errors="coerce")
    ref_scores = pd.to_numeric(merged[ref_col], errors="coerce")
    diff = plat_scores - ref_scores

    summary: Dict[str, Any] = {
        "join_key": key,
        "rows_compared": int(len(merged)),
        "platform_path": platform_path,
        "reference_path": reference_path,
        "platform_score_col": platform_score_col,
        "reference_score_col": ref_col,
        "mean_diff": float(diff.mean()),
        "mean_abs_diff": float(diff.abs().mean()),
        "max_abs_diff": float(diff.abs().max()),
        "rmse": float(np.sqrt((diff ** 2).mean())),
        "correlation": float(plat_scores.corr(ref_scores)) if len(merged) > 1 else None,
        "pct_within_0_01": float((diff.abs() <= 0.01).mean() * 100),
        "pct_within_0_05": float((diff.abs() <= 0.05).mean() * 100),
    }

    merged = merged.copy()
    merged["score_diff"] = diff
    merged["score_abs_diff"] = diff.abs()
    return merged, summary


def prepare_score_comparison_table(df: pd.DataFrame) -> pd.DataFrame:
    """Sort by id ascending and omit redundant predicted_proba for UI/export."""
    out = df.copy()
    if "id" in out.columns:
        out = out.sort_values("id", ascending=True, kind="mergesort")
    elif "row_index" in out.columns:
        out = out.sort_values("row_index", ascending=True, kind="mergesort")
    return out.drop(columns=["predicted_proba"], errors="ignore")
