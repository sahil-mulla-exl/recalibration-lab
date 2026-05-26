import os
import shutil
from fastapi import APIRouter, UploadFile, File, Form
import pandas as pd
from backend.app.utils.session import get_session, update_session, session_dir
from backend.app.utils.data_io import read_tabular_dataframe
from backend.app.utils.model_helpers import extract_model_metadata

router = APIRouter()

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
TARGET_COL = "responded_to_offer"

KIND_TO_SESSION_KEY = {
    "dev_data": "dev_data_path",
    "new_data": "new_data_path",
    "hold_data": "hold_data_path",
    "new_data_oos": "new_data_oos_path",
    "model": "model_path",
    "preprocess": "preprocess_path",
    "features": "features_path",
}

SAMPLE_FILES = {
    "dev_data": "dev_sample.parquet",
    "new_data": "new_sample.parquet",
    "hold_data": "hold_sample.parquet",
    "new_data_oos": "oos_sample.parquet",
    "model": "card_response_v2.3.pkl",
    "preprocess": "preprocess.py",
    "features": "feature_engineering.py",
}


def _read_dataframe(path: str):
    """Read a parquet or csv file into a DataFrame."""
    try:
        return read_tabular_dataframe(path)
    except Exception:
        return None


def _infer_target_column(df, preferred_target: str | None = None) -> str | None:
    if preferred_target and preferred_target in df.columns:
        return preferred_target

    common_names = {
        "responded_to_offer", "target", "label", "y",
        "outcome", "response", "is_default", "default", "churn",
    }
    for col in df.columns:
        if str(col).strip().lower() in common_names:
            return str(col)

    # Fallback: pick first binary-like column.
    for col in df.columns:
        s = df[col]
        non_null = s.dropna()
        if len(non_null) == 0:
            continue
        uniq = non_null.unique()
        if len(uniq) <= 2:
            return str(col)
    return None


def _data_summary(df, target_column: str | None = None) -> dict:
    """Compute schema summary for a tabular dataset."""
    numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
    cat_cols = df.select_dtypes(include=["object", "category", "bool"]).columns.tolist()
    null_cells = int(df.isnull().sum().sum())
    total_cells = max(len(df) * len(df.columns), 1)
    resolved_target = _infer_target_column(df, target_column)

    summary = {
        "rows": int(len(df)),
        "cols": int(len(df.columns)),
        "columns": [str(c) for c in df.columns],
        "numeric_cols": len(numeric_cols),
        "cat_cols": len(cat_cols),
        "null_pct": round(null_cells / total_cells * 100, 2),
        "target_present": resolved_target is not None,
        "target_column": resolved_target,
    }
    if resolved_target is not None:
        try:
            numeric_target = pd.to_numeric(df[resolved_target], errors="coerce")
            valid_ratio = float(numeric_target.notna().mean()) if len(numeric_target) else 0.0
            summary["target_rate"] = round(float(numeric_target.mean()), 4) if valid_ratio >= 0.5 else None
        except Exception:
            summary["target_rate"] = None
    return summary


def _schema_check(dev_df, new_df, target_column: str | None = None) -> dict:
    """Compare candidate dataset schema against dev_data baseline."""
    dev_cols = list(dev_df.columns)
    new_cols = list(new_df.columns)
    dev_set = set(dev_cols)
    new_set = set(new_cols)

    missing = sorted(dev_set - new_set)
    extra = sorted(new_set - dev_set)

    dtype_mismatches = []
    for col in dev_set & new_set:
        if str(dev_df[col].dtype) != str(new_df[col].dtype):
            dtype_mismatches.append({
                "col": col,
                "dev": str(dev_df[col].dtype),
                "new": str(new_df[col].dtype),
            })

    if target_column:
        target_in_dev = target_column in dev_set
        target_in_new = target_column in new_set
        target_gate = target_in_dev == target_in_new
    else:
        target_in_dev = _infer_target_column(dev_df) is not None
        target_in_new = _infer_target_column(new_df) is not None
        target_gate = True

    return {
        "match": (
            not missing
            and not extra
            and not dtype_mismatches
            and target_gate
        ),
        "common_cols": len(dev_set & new_set),
        "missing_cols": missing,
        "extra_cols": extra,
        "dtype_mismatches": dtype_mismatches,
        "target_in_dev": target_in_dev,
        "target_in_new": target_in_new,
    }


def _get_file_meta(path: str, kind: str, dev_data_path: str | None = None, target_column: str | None = None) -> dict:
    meta: dict = {"path": path, "kind": kind}
    try:
        meta["size_kb"] = round(os.path.getsize(path) / 1024, 1)

        if path.endswith(".parquet") or path.endswith(".csv"):
            df = _read_dataframe(path)
            if df is not None:
                meta.update(_data_summary(df, target_column=target_column))
                # Schema reconciliation for scoring/hold datasets against
                # dev_data baseline (all three dataset schemas should align).
                if kind in {"new_data", "hold_data", "new_data_oos"} and dev_data_path and os.path.exists(dev_data_path):
                    try:
                        dev_df = _read_dataframe(dev_data_path)
                        if dev_df is not None:
                            meta["schema_check"] = _schema_check(dev_df, df, target_column=target_column)
                    except Exception as e:
                        meta["schema_check"] = {"error": str(e)}

        elif path.endswith(".pkl"):
            import joblib
            model = joblib.load(path)
            meta.update(extract_model_metadata(model))

    except Exception as e:
        meta["error"] = str(e)
    return meta


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    kind: str = Form(...),
    session_id: str = Form(...),
    target_variable: str | None = Form(default=None),
    outcome_variable: str | None = Form(default=None),
):
    if kind not in KIND_TO_SESSION_KEY:
        return {"error": f"Unknown kind: {kind}"}
    if kind in {"preprocess", "features"} and not str(file.filename).lower().endswith(".py"):
        return {"error": "Only .py files are supported for code artifacts"}

    sess_dir = session_dir(session_id)
    dest_path = os.path.join(sess_dir, file.filename)

    content = await file.read()
    with open(dest_path, "wb") as f:
        f.write(content)

    session_key = KIND_TO_SESSION_KEY[kind]
    update_payload = {session_key: dest_path}
    if target_variable:
        update_payload["target_variable"] = target_variable
    if outcome_variable:
        update_payload["outcome_variable"] = outcome_variable
    if kind == "model":
        try:
            import joblib
            from backend.app.services.recalibration_agent import (
                _extract_base_params_from_uploaded_model,
                _resolve_grid_key,
            )
            from backend.app.utils.model_helpers import extract_model_feature_names

            model_entry = (get_session(session_id) or {}).get("model_entry") or {}
            model_class = model_entry.get("model_class") or "XGBoost"
            grid_key = _resolve_grid_key(str(model_class))
            loaded = joblib.load(dest_path)
            uploaded_hp = _extract_base_params_from_uploaded_model(dest_path, grid_key)
            update_payload["uploaded_model_hyperparameters"] = uploaded_hp
            update_payload["uploaded_model_feature_names"] = extract_model_feature_names(loaded)
        except Exception:
            update_payload["uploaded_model_hyperparameters"] = {}
            update_payload["uploaded_model_feature_names"] = []

    update_session(session_id, update_payload)

    # For new_data, run schema check against currently-stored dev_data path
    session = get_session(session_id) or {}
    dev_data_path = session.get("dev_data_path")
    resolved_target = target_variable or session.get("target_variable")
    meta = _get_file_meta(dest_path, kind, dev_data_path=dev_data_path, target_column=resolved_target)
    meta["filename"] = file.filename
    return meta


@router.post("/load-samples")
async def load_samples(body: dict):
    session_id = body.get("session_id")
    if not session_id:
        return {"error": "session_id required"}
    target_variable = body.get("target_variable")
    outcome_variable = body.get("outcome_variable")
    if target_variable:
        update_session(session_id, {"target_variable": target_variable})
    if outcome_variable:
        update_session(session_id, {"outcome_variable": outcome_variable})

    sess_dir = session_dir(session_id)

    # First pass: copy all sample files & record paths so schema check has
    # access to dev_data when it processes new_data.
    paths: dict[str, str] = {}
    for kind, filename in SAMPLE_FILES.items():
        src = os.path.join(DATA_DIR, filename)
        if not os.path.exists(src):
            paths[kind] = ""
            continue
        dest = os.path.join(sess_dir, filename)
        shutil.copy2(src, dest)
        paths[kind] = dest
        update_session(session_id, {KIND_TO_SESSION_KEY[kind]: dest})

    # Second pass: compute meta (with schema check available for new_data).
    results: dict[str, dict] = {}
    dev_data_path = paths.get("dev_data") or None
    for kind, filename in SAMPLE_FILES.items():
        path = paths.get(kind) or ""
        if not path:
            results[kind] = {"error": f"Sample file not found: {filename}"}
            continue
        meta = _get_file_meta(path, kind, dev_data_path=dev_data_path, target_column=target_variable)
        meta["filename"] = filename
        results[kind] = meta

    return {"loaded": results, "session_id": session_id}


@router.post("/remove")
async def remove_file(body: dict):
    session_id = body.get("session_id")
    kind = body.get("kind")
    if not session_id:
        return {"error": "session_id required"}
    if kind not in KIND_TO_SESSION_KEY:
        return {"error": f"Unknown kind: {kind}"}

    session = get_session(session_id) or {}
    session_key = KIND_TO_SESSION_KEY[kind]
    existing_path = session.get(session_key)

    removed = False
    remove_error = None
    if existing_path and isinstance(existing_path, str) and os.path.exists(existing_path):
        try:
            os.remove(existing_path)
            removed = True
        except Exception as e:
            remove_error = str(e)

    update_session(session_id, {session_key: None})
    resp = {"ok": True, "kind": kind, "removed": removed}
    if remove_error:
        resp["remove_error"] = remove_error
    return resp
