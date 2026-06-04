"""Resolve OOT / holdout data from uploaded Hold Data or dev time-split fallback."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

import pandas as pd

from backend.app.utils.data_io import read_tabular_dataframe


def has_uploaded_hold(session: Dict[str, Any]) -> bool:
    hold_path = session.get("hold_data_path")
    return bool(hold_path and os.path.exists(hold_path))


def has_uploaded_oos(session: Dict[str, Any]) -> bool:
    oos_path = session.get("new_data_oos_path")
    return bool(oos_path and os.path.exists(oos_path))


def load_oos_dataframe(session: Dict[str, Any], data_dir: str) -> Optional[pd.DataFrame]:
    """Load raw OOS upload from ingestion."""
    oos_path = session.get("new_data_oos_path")
    if oos_path and os.path.exists(oos_path):
        return read_tabular_dataframe(oos_path)
    sample = os.path.join(data_dir, "oos_sample.parquet")
    if os.path.exists(sample):
        return read_tabular_dataframe(sample)
    return None


def load_hold_dataframe(session: Dict[str, Any], data_dir: str) -> Optional[pd.DataFrame]:
    """Load raw hold/OOT upload from ingestion."""
    hold_path = session.get("hold_data_path")
    if hold_path and os.path.exists(hold_path):
        return read_tabular_dataframe(hold_path)
    sample = os.path.join(data_dir, "hold_sample.parquet")
    if os.path.exists(sample):
        return read_tabular_dataframe(sample)
    return None


def load_oot_dataframe(
    session: Dict[str, Any],
    dev_path: str,
    *,
    data_dir: Optional[str] = None,
    prefer_processed: bool = True,
) -> Tuple[pd.DataFrame, str]:
    """
    Return OOT dataframe and source label.

    Priority:
    1. processed_hold_path (post data-processing)
    2. hold_data_path (raw upload)
    3. last oot_pct slice of dev
    """
    processed_hold = session.get("processed_hold_path")
    if prefer_processed and processed_hold and os.path.exists(processed_hold):
        return pd.read_parquet(processed_hold), "uploaded_hold_processed"

    resolved_data_dir = data_dir or os.path.dirname(dev_path)
    hold_df = load_hold_dataframe(session, resolved_data_dir)
    if hold_df is not None:
        return hold_df, "uploaded_hold_raw"

    dev_df = read_tabular_dataframe(dev_path)
    oot_pct = float(session.get("oot_pct") or 0.2)
    split_idx = int(len(dev_df) * (1 - oot_pct))
    return dev_df.iloc[split_idx:].copy(), "dev_time_split"


def load_oos_evaluation_dataframe(
    session: Dict[str, Any],
    data_dir: str,
    *,
    prefer_processed: bool = True,
) -> Tuple[pd.DataFrame, str]:
    """
    Return New Test Data for evaluation.

    Priority:
    1. processed_oos_path
    2. new_data_oos_path (raw upload)
    3. bundled oos_sample.parquet
    """
    processed_oos = session.get("processed_oos_path")
    if prefer_processed and processed_oos and os.path.exists(processed_oos):
        return pd.read_parquet(processed_oos), "uploaded_oos_processed"

    oos_df = load_oos_dataframe(session, data_dir)
    if oos_df is not None:
        return oos_df, "uploaded_oos_raw"

    hold_df = load_hold_dataframe(session, data_dir)
    if hold_df is not None:
        return hold_df.copy(), "hold_fallback_for_oos"

    raise FileNotFoundError(
        "New Test Data is required for evaluation. Upload new_data_oos or run data processing."
    )
