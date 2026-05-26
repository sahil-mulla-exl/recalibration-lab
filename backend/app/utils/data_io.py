from __future__ import annotations

import os
from typing import Callable, List, Tuple

import pandas as pd


def read_tabular_dataframe(path: str) -> pd.DataFrame:
    """
    Read a tabular dataset from CSV or Parquet.

    Tries the most likely reader first based on file extension, then falls back
    to the other supported reader. This keeps ingestion resilient even when a
    file has the wrong extension.
    """
    ext = os.path.splitext(path)[1].lower()
    readers: List[Tuple[str, Callable[[str], pd.DataFrame]]] = []

    if ext == ".parquet":
        readers = [("parquet", pd.read_parquet), ("csv", pd.read_csv)]
    elif ext == ".csv":
        readers = [("csv", pd.read_csv), ("parquet", pd.read_parquet)]
    else:
        readers = [("parquet", pd.read_parquet), ("csv", pd.read_csv)]

    errors: List[str] = []
    for label, reader in readers:
        try:
            return reader(path)
        except Exception as exc:
            errors.append(f"{label}: {exc}")

    raise ValueError(
        f"Unable to parse dataset '{path}' as csv/parquet. "
        f"Reader errors: {' | '.join(errors)}"
    )
