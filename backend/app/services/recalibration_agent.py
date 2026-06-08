import asyncio
import logging
import os
import random
import numpy as np
import pandas as pd
from typing import Any, Dict, List
import joblib
from backend.app.services.base import Agent
from backend.app.utils.session import get_session, update_session
from backend.app.utils.model_features import resolve_session_model_features
from backend.app.utils.model_helpers import (
    TARGET_COL,
    encode_categoricals,
    extract_training_hyperparameters,
    score_dataframe,
    save_model,
    train_model,
    resolve_estimator,
)
from backend.app.utils.drift_metrics import compute_auc, compute_rmse, compute_mae, compute_r2
from backend.app.utils.data_io import read_tabular_dataframe
from backend.app.utils.oot_data import load_oos_evaluation_dataframe, load_oot_dataframe
from backend.app.config.agent_task_labels import RECAL_SCORE_OOT

logger = logging.getLogger(__name__)

# Tuning caps — keeps trials responsive and avoids silent multi-minute hangs.
TUNING_MAX_ROWS = 8_000
TUNING_MAX_VALID_ROWS = 2_000
TUNING_MAX_FEATURES = 500
TUNING_MAX_TRIALS = 30
TUNING_PARALLEL_WORKERS = 2

HP_GRIDS = {
    "xgboost": {
        "n_estimators": [50, 100, 150, 200, 250],
        "max_depth": [3, 4, 5, 6],
        "learning_rate": [0.02, 0.05, 0.08, 0.10, 0.15],
        "subsample": [0.7, 0.8, 0.9],
        "colsample_bytree": [0.7, 0.8, 0.9],
    },
    "lightgbm": {
        "n_estimators": [50, 100, 150, 200],
        "max_depth": [3, 4, 5, 6],
        "learning_rate": [0.02, 0.05, 0.10, 0.15],
        "subsample": [0.7, 0.8, 0.9],
        "colsample_bytree": [0.7, 0.8, 0.9],
    },
    "logistic": {
        "C": [0.001, 0.01, 0.1, 1.0, 10.0],
    },
}


def _resolve_grid_key(model_class: str) -> str:
    grid_key = (model_class or "").lower().replace("-", "").replace(" ", "")
    if "xgb" in grid_key:
        return "xgboost"
    if "lgbm" in grid_key or "lightgbm" in grid_key or "light" in grid_key:
        return "lightgbm"
    if "logistic" in grid_key or "lr" in grid_key:
        return "logistic"
    return "xgboost"


def _supported_hp_keys(grid_key: str) -> set[str]:
    return set(HP_GRIDS.get(grid_key, HP_GRIDS["xgboost"]).keys())


def _extract_base_params_from_uploaded_model(model_path: str, grid_key: str) -> Dict[str, Any]:
    """Extract supported HP values from uploaded .pkl model artifact."""
    if not model_path or not os.path.exists(model_path):
        return {}
    try:
        loaded = joblib.load(model_path)
    except Exception:
        return {}
    return extract_training_hyperparameters(loaded, _supported_hp_keys(grid_key))


def _clean_training_params(params: Dict[str, Any]) -> Dict[str, Any]:
    """Drop null/NaN entries so train_* helpers use their defaults instead of None."""
    cleaned: Dict[str, Any] = {}
    for key, value in (params or {}).items():
        if value is None:
            continue
        try:
            if isinstance(value, float) and np.isnan(value):
                continue
        except Exception:
            pass
        cleaned[key] = value
    return cleaned


def _resolve_uploaded_hyperparameters(
    session: Dict[str, Any],
    grid_key: str,
) -> Dict[str, Any]:
    """Prefer live .pkl extraction; fall back to values cached at ingestion/upload."""
    from_path = _extract_base_params_from_uploaded_model(session.get("model_path"), grid_key)
    cached = session.get("uploaded_model_hyperparameters") or {}
    if not isinstance(cached, dict):
        cached = {}
    merged = {**cached, **from_path}
    return _clean_training_params(merged)


def _coerce_like_default(value: Any, default_values: List[Any]) -> Any:
    """Cast UI values to the same type family as existing grid values."""
    if not default_values:
        return value
    sample = default_values[0]
    try:
        if isinstance(sample, bool):
            return bool(value)
        if isinstance(sample, int) and not isinstance(sample, bool):
            return int(round(float(value)))
        if isinstance(sample, float):
            return float(value)
    except Exception:
        return value
    return value


def _build_hp_grid_from_session(grid_key: str, configured_space: Dict[str, Any]) -> Dict[str, List[Any]]:
    """
    Build trial candidate grid from frontend-configured search space.
    Frontend sends min/max or selected[] values; we project those onto
    supported backend parameters and fall back to defaults where missing.
    """
    default_grid = HP_GRIDS.get(grid_key, HP_GRIDS["xgboost"])
    hp_grid: Dict[str, List[Any]] = {k: list(v) for k, v in default_grid.items()}
    if not configured_space:
        return hp_grid

    alias_map = {
        "feature_fraction": "colsample_bytree",
        "bagging_fraction": "subsample",
    }

    for raw_key, raw_cfg in (configured_space or {}).items():
        key = alias_map.get(raw_key, raw_key)
        if key not in hp_grid:
            continue

        cfg = raw_cfg if isinstance(raw_cfg, dict) else {}
        defaults = hp_grid[key]

        selected = cfg.get("selected")
        if isinstance(selected, list) and selected:
            values = [_coerce_like_default(v, defaults) for v in selected]
            hp_grid[key] = values
            continue

        min_v = cfg.get("min")
        max_v = cfg.get("max")
        if min_v is None and max_v is None:
            continue

        lo = min_v if min_v is not None else min(defaults)
        hi = max_v if max_v is not None else max(defaults)
        if lo > hi:
            lo, hi = hi, lo

        filtered = [v for v in defaults if lo <= v <= hi]
        if filtered:
            hp_grid[key] = filtered
            continue

        # If UI range does not intersect defaults, choose closest default.
        nearest = min(defaults, key=lambda v: abs(float(v) - float((lo + hi) / 2.0)))
        hp_grid[key] = [nearest]

    return hp_grid


def _select_feature_columns(
    session: Dict[str, Any],
    df: pd.DataFrame,
    target_col: str,
    outcome_col: str,
    drop_list: List[str],
) -> List[str]:
    cols = resolve_session_model_features(
        session,
        df,
        exclude={target_col, outcome_col, TARGET_COL, "predicted_outcome"},
    )
    drop_set = set(drop_list or [])
    return [c for c in cols if c not in drop_set]


def _cap_feature_matrix(X: pd.DataFrame, max_features: int) -> pd.DataFrame:
    if X.shape[1] <= max_features:
        return X
    variances = X.var(numeric_only=True).fillna(0.0)
    keep_cols = variances.nlargest(max_features).index.tolist()
    return X[keep_cols]


def _prepare_xy_from_processed(
    df: pd.DataFrame,
    feature_cols: List[str],
    outcome_col: str,
    max_features: int,
) -> tuple[pd.DataFrame, np.ndarray]:
    present = [c for c in feature_cols if c in df.columns]
    X = df[present].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    X = X.loc[:, ~X.columns.duplicated()]
    X = _cap_feature_matrix(X, max_features)
    y = pd.to_numeric(df[outcome_col], errors="coerce").fillna(0.0).values
    return X, y


def _align_processed_to_columns(
    df: pd.DataFrame,
    columns: List[str],
    outcome_col: str,
) -> tuple[pd.DataFrame, np.ndarray]:
    X = df.reindex(columns=columns, fill_value=0.0).apply(pd.to_numeric, errors="coerce").fillna(0.0)
    y = pd.to_numeric(df[outcome_col], errors="coerce").fillna(0.0).values
    return X, y


class RecalibrationAgent(Agent):
    async def _log_console(self, message: str) -> None:
        """Emit to SSE stream and stdout so terminal shows progress during long tuning."""
        print(f"[recalibration] {message}", flush=True)
        logger.info(message)
        await self.log(message)

    def __init__(self, session_id: str, queue: asyncio.Queue):
        super().__init__("recalibration", session_id, queue)
        self._declare_tasks([
            {"id": "apply_variable_drops",  "name": "Apply variable drops"},
            {"id": "prepare_training_data", "name": "Prepare train and test feature matrices"},
            {"id": "setup_hp_search",       "name": "Set up hyperparameter search"},
            {"id": "run_hp_tuning",         "name": "Run hyperparameter tuning (30 trials)"},
            {"id": "train_final_model",     "name": "Train final model on best hyperparameters"},
            {"id": "score_oot",             "name": RECAL_SCORE_OOT},
            {"id": "serialize_new_model",   "name": "Serialize new model object"},
        ])

    async def run(self) -> Dict[str, Any]:
        session = get_session(self.session_id)
        if not session:
            await self.failed("Session not found")
            return {}

        await self.started()
        model_entry = session.get("model_entry") or {}
        problem_type = str(model_entry.get("problem_type") or "classification").lower()
        is_regression = problem_type.startswith("reg")

        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
        dev_path = session.get("dev_data_path") or os.path.join(data_dir, "dev_sample.parquet")
        drop_list = session.get("drop_list") or []
        model_class = session.get("model_class") or "XGBoost"
        hp_method = session.get("hp_method") or "random"
        n_trials = int(session.get("hp_trials") or 30)
        selected_action = str(session.get("selected_recommended_action") or "").strip().lower()
        grid_key = _resolve_grid_key(model_class)
        uploaded_model_path = session.get("model_path")
        skip_tuning = selected_action in {"recal_simple", "no_action"}
        # Uploaded .pkl hyperparameters are only used when tuning is bypassed.
        base_uploaded_params = _resolve_uploaded_hyperparameters(session, grid_key) if skip_tuning else {}
        seeded_from_uploaded_model = skip_tuning and bool(base_uploaded_params)
        target_col = session.get("target_variable") or session.get("processed_target_column") or TARGET_COL
        outcome_col = session.get("outcome_variable") or session.get("processed_dev_outcome_column") or target_col
        # Training labels must use the actual target (binary/regression outcome), not prediction/score columns.
        def _train_label_col(df: pd.DataFrame) -> str:
            if target_col in df.columns:
                return target_col
            if outcome_col in df.columns and outcome_col != target_col:
                series = pd.to_numeric(df[outcome_col], errors="coerce").dropna()
                if len(series) > 0:
                    uniq = set(series.unique().tolist())
                    if uniq.issubset({0, 1, 0.0, 1.0}) or len(uniq) <= 20:
                        return outcome_col
            if TARGET_COL in df.columns:
                return TARGET_COL
            return outcome_col if outcome_col in df.columns else target_col

        processed_dev_path = session.get("processed_dev_path")
        processed_new_path = session.get("processed_new_path")
        processed_hold_path = session.get("processed_hold_path")
        processed_recal_train_path = session.get("processed_recal_train_path")
        processed_recal_train_csv_path = session.get("processed_recal_train_csv_path")
        use_processed_train = bool(processed_dev_path and os.path.exists(processed_dev_path))

        # Task 1: apply_variable_drops
        await self.task_started("apply_variable_drops")
        await asyncio.sleep(0.5)
        if use_processed_train:
            schema_df = pd.read_parquet(processed_dev_path)
            await self.log(f"Using processed dev artifact for feature schema: {processed_dev_path}")
        else:
            schema_df = read_tabular_dataframe(dev_path)
            await self.log("Processed dev artifact missing — using raw dev upload (may use more memory)")
        dev_outcome_col = _train_label_col(schema_df)
        if dev_outcome_col not in schema_df.columns:
            await self.task_failed(
                "apply_variable_drops",
                f"Selected outcome/target column missing in dev data: outcome='{outcome_col}', target='{target_col}'",
            )
            await self.failed(
                f"Selected outcome/target column missing in dev data: outcome='{outcome_col}', target='{target_col}'"
            )
            return {}
        candidate_features = _select_feature_columns(session, schema_df, target_col, outcome_col, [])
        available_features = [c for c in candidate_features if c not in drop_list]
        await self.log(f"Original features: {len(candidate_features)}")
        await self.log(f"Dropped: {drop_list}")
        await self.log(f"Remaining features: {len(available_features)}")
        if not available_features:
            await self.task_failed("apply_variable_drops", "No features available after applying drop list")
            await self.failed("No features available after applying drop list")
            return {}
        await self.task_completed("apply_variable_drops", f"{len(available_features)} features retained (dropped {len(drop_list)})")

        # Task 2: prepare_training_data
        await self.task_started("prepare_training_data")
        await asyncio.sleep(0.6)
        max_tuning_features = int(session.get("max_tuning_features") or TUNING_MAX_FEATURES)
        oot_df: pd.DataFrame
        oot_source: str
        train_rows: int
        recal_train_frame: pd.DataFrame | None = None

        if use_processed_train:
            if processed_recal_train_path and os.path.exists(processed_recal_train_path):
                train_proc = pd.read_parquet(processed_recal_train_path)
                await self.log(
                    f"Using recalibration training artifact ({len(train_proc):,} rows): {processed_recal_train_path}"
                )
            else:
                from backend.app.utils.processed_paths import ensure_recalibration_training_artifact

                built_path = ensure_recalibration_training_artifact(self.session_id, session)
                if built_path and os.path.exists(built_path):
                    train_proc = pd.read_parquet(built_path)
                    processed_recal_train_path = built_path
                    await self.log(
                        f"Built recalibration training artifact ({len(train_proc):,} rows): {built_path}"
                    )
                else:
                    train_proc = pd.read_parquet(processed_dev_path)
                    if processed_new_path and os.path.exists(processed_new_path):
                        new_proc = pd.read_parquet(processed_new_path)
                        train_proc = pd.concat([train_proc, new_proc], ignore_index=True)
                        await self.log(
                            f"Appended New Train Data: {len(new_proc):,} rows → combined training set {len(train_proc):,} rows"
                        )
            train_rows = len(train_proc)
            train_features = [c for c in available_features if c in train_proc.columns]
            if not train_features:
                await self.task_failed("prepare_training_data", "No overlapping features in processed dev artifact")
                await self.failed("No overlapping features in processed dev artifact")
                return {}
            await self._log_console(
                f"Train matrix from processed dev ({train_rows:,} rows, {len(train_features)} feature columns)"
            )
            recal_train_frame = train_proc
            X_train, y_train = _prepare_xy_from_processed(
                train_proc, train_features, dev_outcome_col, max_tuning_features
            )

            if processed_hold_path and os.path.exists(processed_hold_path):
                oot_proc = pd.read_parquet(processed_hold_path)
                oot_source = "uploaded_hold_processed"
                hold_outcome_col = _train_label_col(oot_proc)
                if hold_outcome_col not in oot_proc.columns:
                    await self.task_failed(
                        "prepare_training_data",
                        f"Processed hold missing outcome/target: outcome='{outcome_col}', target='{target_col}'",
                    )
                    await self.failed(
                        f"Processed hold missing outcome/target: outcome='{outcome_col}', target='{target_col}'"
                    )
                    return {}
                oot_features = [c for c in X_train.columns if c in oot_proc.columns]
                if not oot_features:
                    await self.task_failed(
                        "prepare_training_data",
                        "No overlapping features between processed dev and processed hold",
                    )
                    await self.failed("No overlapping features between processed dev and processed hold")
                    return {}
                X_oot, y_oot = _align_processed_to_columns(
                    oot_proc, list(X_train.columns), hold_outcome_col
                )
                oot_df = oot_proc
            else:
                oot_df, oot_source = load_oot_dataframe(
                    session, dev_path, data_dir=data_dir, prefer_processed=False
                )
                hold_outcome_col = _train_label_col(oot_df)
                if hold_outcome_col not in oot_df.columns:
                    await self.task_failed(
                        "prepare_training_data",
                        f"OOT/hold data missing outcome/target columns: outcome='{outcome_col}', target='{target_col}'",
                    )
                    await self.failed(
                        f"OOT/hold data missing outcome/target columns: outcome='{outcome_col}', target='{target_col}'"
                    )
                    return {}
                oot_features = [c for c in available_features if c in oot_df.columns]
                X_oot_raw = encode_categoricals(oot_df[oot_features])
                X_oot_raw = X_oot_raw.loc[:, ~X_oot_raw.columns.duplicated()]
                X_oot_raw = _cap_feature_matrix(X_oot_raw, max_tuning_features)
                common = [c for c in X_train.columns if c in X_oot_raw.columns]
                X_oot = X_oot_raw.reindex(columns=common, fill_value=0.0)
                X_train = X_train[common]
                y_oot = pd.to_numeric(oot_df[hold_outcome_col], errors="coerce").fillna(0.0).values
        else:
            dev_df = read_tabular_dataframe(dev_path)
            new_path = session.get("new_data_path")
            train_frames = [dev_df]
            if new_path and os.path.exists(new_path):
                new_raw = read_tabular_dataframe(new_path)
                train_frames.append(new_raw)
                await self.log(f"Appended New Train Data: {len(new_raw):,} rows to raw training set")
            combined = pd.concat(train_frames, ignore_index=True)
            train_df = combined[available_features + [dev_outcome_col]].copy()
            recal_train_frame = train_df
            train_rows = len(train_df)
            oot_df, oot_source = load_oot_dataframe(
                session, dev_path, data_dir=data_dir, prefer_processed=False
            )
            hold_outcome_col = _train_label_col(oot_df)
            if hold_outcome_col not in oot_df.columns:
                await self.task_failed(
                    "prepare_training_data",
                    f"OOT/hold data missing outcome/target columns: outcome='{outcome_col}', target='{target_col}'",
                )
                await self.failed(
                    f"OOT/hold data missing outcome/target columns: outcome='{outcome_col}', target='{target_col}'"
                )
                return {}
            oot_feature_cols = [c for c in available_features if c in oot_df.columns]
            if not oot_feature_cols:
                await self.task_failed("prepare_training_data", "No overlapping features between dev and hold (OOT) data")
                await self.failed("No overlapping features between dev and hold (OOT) data")
                return {}
            oot_df = oot_df[oot_feature_cols + [hold_outcome_col]].copy()

            fast_mode = bool(session.get("fast_mode", True))
            max_categorical_levels = int(session.get("max_categorical_levels") or 100)
            if fast_mode:
                high_card_drops: List[str] = []
                for col in list(available_features):
                    s = train_df[col]
                    if (
                        pd.api.types.is_object_dtype(s)
                        or pd.api.types.is_categorical_dtype(s)
                        or pd.api.types.is_bool_dtype(s)
                    ):
                        levels = int(s.astype(str).nunique(dropna=True))
                        if levels > max_categorical_levels:
                            high_card_drops.append(col)
                if high_card_drops:
                    available_features = [c for c in available_features if c not in high_card_drops]
                    oot_feature_cols = [c for c in available_features if c in oot_df.columns]
                    train_df = combined[available_features + [dev_outcome_col]].copy()
                    oot_df = oot_df[oot_feature_cols + [hold_outcome_col]].copy()
                    await self.log(
                        f"Fast mode: dropped {len(high_card_drops)} high-cardinality categorical feature(s) "
                        f"(threshold={max_categorical_levels})"
                    )

            X_train = encode_categoricals(train_df[available_features])
            y_train = train_df[dev_outcome_col].values
            X_train = X_train.loc[:, ~X_train.columns.duplicated()]
            X_train = _cap_feature_matrix(X_train, max_tuning_features)

            X_oot = encode_categoricals(oot_df[oot_feature_cols])
            X_oot = X_oot.loc[:, ~X_oot.columns.duplicated()]
            X_oot = _cap_feature_matrix(X_oot, max_tuning_features)
            common = [c for c in X_train.columns if c in X_oot.columns]
            X_train = X_train[common]
            X_oot = X_oot.reindex(columns=common, fill_value=0.0)
            y_oot = oot_df[hold_outcome_col].values

        await self.log(f"OOT source: {oot_source} | OOT rows: {len(oot_df):,}")
        if oot_source.startswith("uploaded_hold"):
            await self.log("Training on full dev sample; evaluating on uploaded Hold (OOT) data")
        elif oot_source == "dev_time_split":
            await self.log(f"Hold not uploaded — using dev time-split for OOT (oot_pct={session.get('oot_pct') or 0.2})")

        await self.log(f"Train: {train_rows:,} rows | OOT: {len(oot_df):,} rows")
        if is_regression:
            await self.log(f"Train target mean: {float(np.mean(y_train)):.4f}")
        else:
            await self.log(f"Train target rate: {y_train.mean()*100:.1f}%")
        await self.log(f"Modeling features: {X_train.shape[1]} (cap={max_tuning_features})")

        from backend.app.utils.processed_paths import persist_recalibration_training_parquet

        processed_recal_train_path = None
        if recal_train_frame is not None and len(recal_train_frame) > 0:
            processed_recal_train_path = await asyncio.to_thread(
                persist_recalibration_training_parquet, recal_train_frame, self.session_id
            )
            await self.log(
                f"Recalibration training artifact saved ({len(recal_train_frame):,} rows): {processed_recal_train_path}"
            )
            update_session(
                self.session_id,
                {
                    "processed_recal_train_path": processed_recal_train_path,
                    "recalibration_training_rows": int(len(recal_train_frame)),
                },
            )

        await self.task_completed(
            "prepare_training_data",
            f"Train={train_rows:,} | OOT={len(oot_df):,} | Features={X_train.shape[1]} | source={oot_source}",
        )

        # Task 3: setup_hp_search
        await self.task_started("setup_hp_search")
        await asyncio.sleep(0.4)
        configured_space = session.get("hp_search_space") or {}
        hp_grid = _build_hp_grid_from_session(grid_key, configured_space)
        await self.log(f"Model class: {model_class} (grid: {grid_key})")
        if skip_tuning:
            await self.log(f"Selected action '{selected_action}' -> hyperparameter tuning skipped")
            if base_uploaded_params:
                await self.log(f"Using hyperparameters from uploaded model: {base_uploaded_params}")
            else:
                await self.log("No uploaded hyperparameters found; training with library defaults")
        else:
            await self.log(f"Search method: {hp_method} | Trials: {n_trials}")
            if configured_space:
                await self.log(
                    f"Using Diagnostics optimization inputs for {len(configured_space)} parameter(s)"
                )
            else:
                await self.log("No Diagnostics optimization inputs in session; using default HP grid")
            await self.log("Uploaded model hyperparameters ignored during tuning (Diagnostics search space only)")
        await self.log(f"HP space: {list(hp_grid.keys())}")
        for param, values in hp_grid.items():
            await self.log(f"  {param}: {values}")
        if skip_tuning:
            await self.task_completed("setup_hp_search", f"{grid_key} | tuning bypassed (no optimisation)")
        else:
            await self.task_completed("setup_hp_search", f"{grid_key} | {n_trials} {hp_method} trials")

        # Task 4: run_hp_tuning
        await self.task_started("run_hp_tuning")
        rng = random.Random(42)
        best_score = -float("inf")
        best_params: Dict[str, Any] = dict(base_uploaded_params) if skip_tuning else {}
        trial_history: List[Dict[str, Any]] = []
        n_trials = min(n_trials, TUNING_MAX_TRIALS)
        tune_rows = min(TUNING_MAX_ROWS, len(X_train))
        X_tune = X_train.iloc[:tune_rows]
        y_tune = y_train[:tune_rows]
        valid_size = min(TUNING_MAX_VALID_ROWS, len(X_tune))
        X_valid = X_tune.iloc[:valid_size]
        y_valid = y_tune[:valid_size]

        # ── HP sampler ────────────────────────────────────────────────
        # "random"   — uniform i.i.d. sampling
        # "grid"     — round-robin walk through deterministic grid points
        # "bayesian" — TPE-style: warm up with random, then bias new
        #              samples around the top-quantile observed params.
        method = (hp_method or "random").lower()

        def sample_random() -> Dict[str, Any]:
            return {k: rng.choice(v) for k, v in hp_grid.items()}

        def sample_grid(t: int) -> Dict[str, Any]:
            params: Dict[str, Any] = {}
            stride = 1
            for k, vals in hp_grid.items():
                params[k] = vals[(t // stride) % len(vals)]
                stride *= len(vals)
            return params

        def sample_bayesian(top_params: List[Dict[str, Any]]) -> Dict[str, Any]:
            seed = rng.choice(top_params)
            params: Dict[str, Any] = {}
            for k, vals in hp_grid.items():
                if rng.random() < 0.72:           # exploit: nudge ±1 from seed
                    try:
                        idx = vals.index(seed[k])
                    except ValueError:
                        idx = rng.randrange(len(vals))
                    new_idx = max(0, min(len(vals) - 1, idx + rng.choice([-1, 0, 1])))
                    params[k] = vals[new_idx]
                else:                              # explore
                    params[k] = rng.choice(vals)
            return params

        n_warmup = 8 if method == "bayesian" else 0
        loop = asyncio.get_running_loop()

        def _trial_params(params: Dict[str, Any]) -> Dict[str, Any]:
            tuned = dict(params)
            est = tuned.get("n_estimators")
            if isinstance(est, (int, float)) and est > 200:
                tuned["n_estimators"] = 200
            return tuned

        def evaluate_trial(params: Dict[str, Any]) -> float:
            try:
                model_trial = train_model(
                    grid_key, X_tune, y_tune, _trial_params(params), problem_type=problem_type
                )
                if is_regression:
                    preds = model_trial.predict(X_valid)
                    return float(compute_r2(y_valid, preds))
                preds = model_trial.predict_proba(X_valid)[:, 1]
                return float(compute_auc(y_valid, preds))
            except Exception as exc:
                logger.warning("HP trial failed: %s", exc)
                return -float("inf") if is_regression else 0.0

        if skip_tuning:
            # No optimisation: single evaluation using hyperparameters from uploaded .pkl.
            if best_params:
                best_score = await loop.run_in_executor(None, evaluate_trial, best_params)
                trial_history.append(
                    {
                        "trial": 1,
                        "score": round(float(best_score), 4),
                        "params": dict(best_params),
                        "source": "uploaded_model",
                    }
                )
                await self.log(
                    f"Using champion hyperparameters from uploaded model: {best_params} -> "
                    f"{'R2' if is_regression else 'AUC'}={best_score:.4f} on validation slice"
                )
                metric_label = "R2" if is_regression else "AUC"
                await self.task_completed(
                    "run_hp_tuning",
                    f"Champion HP from .pkl (no search) · {metric_label}={best_score:.4f}",
                )
            else:
                best_score = 0.0 if not is_regression else -float("inf")
                await self.log(
                    "[skip] no hyperparameters found in uploaded .pkl; training final model with library defaults"
                )
                await self.task_completed(
                    "run_hp_tuning",
                    "No HP in uploaded .pkl — library defaults will be used",
                )
            await self.progress(1.0)
            n_trials = len(trial_history)
        else:
            await self._log_console(
                f"Starting {method} search: {n_trials} trials | "
                f"tune_rows={tune_rows:,} | valid_rows={valid_size:,} | features={X_tune.shape[1]}"
            )
            metric_label = "R2" if is_regression else "AUC"
            max_workers = max(1, min(TUNING_PARALLEL_WORKERS, os.cpu_count() or 2))

            async def _run_one_trial(trial_idx: int, params: Dict[str, Any]) -> float:
                await self._log_console(
                    f"[{method}] trial {trial_idx}/{n_trials} starting — {params}"
                )
                return await loop.run_in_executor(None, evaluate_trial, params)

            if method in {"random", "grid"}:
                param_list: List[Dict[str, Any]] = []
                for trial in range(n_trials):
                    params = sample_grid(trial) if method == "grid" else sample_random()
                    param_list.append(params)

                effective_trials = len(param_list)
                await self._log_console(
                    f"[{method}] running {effective_trials} trials ({max_workers} parallel workers max)"
                )
                scores: List[float] = []
                batch_size = max_workers
                for batch_start in range(0, effective_trials, batch_size):
                    batch = param_list[batch_start:batch_start + batch_size]
                    batch_scores = await asyncio.gather(
                        *[
                            _run_one_trial(batch_start + i + 1, p)
                            for i, p in enumerate(batch)
                        ]
                    )
                    scores.extend(batch_scores)

                for trial, (params, trial_score) in enumerate(zip(param_list, scores), start=1):
                    if trial_score > best_score:
                        best_score = trial_score
                        best_params = params.copy()
                    trial_history.append(
                        {"trial": trial, "score": round(float(trial_score), 4), "params": params}
                    )
                    await self._log_console(
                        f"[{method}] trial {trial}/{effective_trials}, {metric_label}={trial_score:.4f}, best={best_score:.4f}"
                    )
                    await self.progress(trial / effective_trials)
                n_trials = effective_trials
            else:
                # Bayesian search remains sequential so each trial can adapt from prior results.
                for trial in range(n_trials):
                    if method == "bayesian" and trial >= n_warmup and trial_history:
                        top_k = max(1, len(trial_history) // 4)
                        top_params = [t["params"] for t in
                                      sorted(trial_history, key=lambda x: x["score"], reverse=True)[:top_k]]
                        params = sample_bayesian(top_params)
                    else:
                        params = sample_random()
                    trial_number = len(trial_history) + 1
                    trial_score = await _run_one_trial(trial_number, params)
                    if trial_score > best_score:
                        best_score = trial_score
                        best_params = params.copy()
                    trial_history.append(
                        {"trial": trial_number, "score": round(float(trial_score), 4), "params": params}
                    )
                    await self._log_console(
                        f"[{method}] trial {trial_number}/{n_trials}, {metric_label}={trial_score:.4f}, best={best_score:.4f}"
                    )
                    await self.progress(trial_number / n_trials)
                n_trials = len(trial_history)

        if not skip_tuning:
            best_metric_label = "R2" if is_regression else "AUC"
            await self.task_completed("run_hp_tuning", f"{method} search · best {best_metric_label} = {best_score:.4f} after {n_trials} trials")

        # Task 5: train_final_model
        await self.task_started("train_final_model")
        await asyncio.sleep(1.0)
        await self.log(f"Training final {model_class} with best params: {best_params}")
        final_model = train_model(grid_key, X_train, y_train, best_params, problem_type=problem_type)
        await self.log(f"Final model trained on {len(X_train):,} rows")
        await self.task_completed("train_final_model", f"{model_class} trained | {len(X_train):,} rows")

        processed_recal_train_path = session.get("processed_recal_train_path")
        processed_recal_train_csv_path = session.get("processed_recal_train_csv_path")
        if recal_train_frame is not None and len(recal_train_frame) > 0:
            from backend.app.utils.processed_paths import persist_processed_dataset

            if is_regression:
                train_preds = np.asarray(final_model.predict(X_train), dtype=float)
            else:
                train_preds = np.asarray(final_model.predict_proba(X_train)[:, 1], dtype=float)
            recal_train_paths = await asyncio.to_thread(
                persist_processed_dataset,
                recal_train_frame,
                self.session_id,
                "recal_train",
                new_scores=train_preds,
            )
            processed_recal_train_path = recal_train_paths["parquet"]
            processed_recal_train_csv_path = recal_train_paths["csv"]
            await self.log(
                f"Recalibrated scores on combined training data written: {processed_recal_train_csv_path}"
            )

        # Task 6: score New Test Data (ingestion new_data_oos) for evaluation — not Existing Test holdout.
        await self.task_started("score_oot")
        await asyncio.sleep(0.6)
        from backend.app.config.datasets import NEW_VALIDATION

        oos_eval_df, oos_eval_source = load_oos_evaluation_dataframe(
            session, data_dir, prefer_processed=True
        )
        oos_outcome_col = _train_label_col(oos_eval_df)
        if oos_outcome_col not in oos_eval_df.columns:
            await self.task_failed(
                "score_oot",
                f"{NEW_VALIDATION} missing outcome/target columns for scoring",
            )
            await self.failed(f"{NEW_VALIDATION} missing outcome/target columns for scoring")
            return {}
        oos_feature_cols = [c for c in list(X_train.columns) if c in oos_eval_df.columns]
        if not oos_feature_cols:
            await self.task_failed("score_oot", f"No overlapping features on {NEW_VALIDATION}")
            await self.failed(f"No overlapping features on {NEW_VALIDATION}")
            return {}
        X_oos_eval, y_oos_eval = _align_processed_to_columns(
            oos_eval_df, list(X_train.columns), oos_outcome_col
        )
        if is_regression:
            oos_preds = final_model.predict(X_oos_eval)
            oot_rmse = compute_rmse(y_oos_eval, oos_preds)
            oot_mae = compute_mae(y_oos_eval, oos_preds)
            oot_r2 = compute_r2(y_oos_eval, oos_preds)
            oot_auc = None
            await self.log(f"{NEW_VALIDATION} RMSE: {oot_rmse:.4f}")
            await self.log(f"{NEW_VALIDATION} MAE: {oot_mae:.4f}")
            await self.log(f"{NEW_VALIDATION} R2: {oot_r2:.4f}")
            await self.task_completed("score_oot", f"{NEW_VALIDATION} RMSE={oot_rmse:.4f}, R2={oot_r2:.4f}")
        else:
            oos_preds = final_model.predict_proba(X_oos_eval)[:, 1]
            oot_auc = compute_auc(y_oos_eval, oos_preds)
            oot_rmse = oot_mae = oot_r2 = None
            await self.log(f"{NEW_VALIDATION} AUC: {oot_auc:.4f}")
            await self.log(f"{NEW_VALIDATION} target rate: {y_oos_eval.mean()*100:.1f}%")
            await self.task_completed("score_oot", f"{NEW_VALIDATION} AUC = {oot_auc:.4f}")
        oot_preds = oos_preds

        # Task 7: serialize_new_model
        await self.task_started("serialize_new_model")
        await asyncio.sleep(0.4)
        from backend.app.utils.session import session_dir
        sess_dir = session_dir(self.session_id)
        new_model_path = os.path.join(sess_dir, "recalibrated_model.pkl")
        import joblib
        joblib.dump(final_model, new_model_path)
        model_size_kb = os.path.getsize(new_model_path) / 1024
        await self.log(f"Model serialized to {new_model_path}")
        await self.log(f"File size: {model_size_kb:.1f} KB")

        # Persist recalibrated scores on New Test Data (separate from processed_oos_path).
        from backend.app.utils.processed_paths import persist_processed_dataset

        oot_scores_df = oos_eval_df.copy()
        if "score" not in oot_scores_df.columns:
            orig_col = session.get("processed_score_column") or "score"
            if orig_col in oot_scores_df.columns:
                oot_scores_df["score"] = oot_scores_df[orig_col]
        oot_paths = await asyncio.to_thread(
            persist_processed_dataset,
            oot_scores_df,
            self.session_id,
            "recal_oos",
            new_scores=oot_preds,
        )
        oot_scores_path = oot_paths["parquet"]
        oot_scores_csv_path = oot_paths["csv"]
        await self.log(f"{NEW_VALIDATION} recalibrated predictions written: {oot_scores_csv_path}")

        processed_hold_path = session.get("processed_hold_path")
        processed_hold_csv_path = None
        if processed_hold_path and os.path.exists(processed_hold_path):
            hold_export = pd.read_parquet(processed_hold_path)
            if len(hold_export) == len(oot_preds):
                hold_paths = await asyncio.to_thread(
                    persist_processed_dataset,
                    hold_export,
                    self.session_id,
                    "hold",
                    new_scores=oot_preds,
                )
                processed_hold_path = hold_paths["parquet"]
                processed_hold_csv_path = hold_paths["csv"]
                await self.log(
                    f"Hold artifact updated with new_score and predicted_proba: {processed_hold_csv_path}"
                )

        await self.task_completed("serialize_new_model", f"{model_size_kb:.0f} KB | saved to session")

        result = {
            "new_model_path": new_model_path,
            "oot_scores_path": oot_scores_path,
            "best_params": best_params,
            "best_hp_auc": round(best_score, 4) if not is_regression else None,
            "best_hp_score": round(best_score, 4),
            "oot_auc": round(oot_auc, 4) if oot_auc is not None else None,
            "oot_rmse": round(float(oot_rmse), 6) if oot_rmse is not None else None,
            "oot_mae": round(float(oot_mae), 6) if oot_mae is not None else None,
            "oot_r2": round(float(oot_r2), 6) if oot_r2 is not None else None,
            "n_trials": n_trials,
            "trial_history": trial_history,
            "model_class": model_class,
            "problem_type": problem_type,
            "features_used": available_features,
            "n_features": len(available_features),
            "selected_target_column": target_col,
            "selected_outcome_column": outcome_col,
            "dev_outcome_column_used": dev_outcome_col,
            "train_rows": len(X_train),
            "processed_recal_train_path": processed_recal_train_path,
            "oot_rows": len(oos_eval_df),
            "oot_source": oos_eval_source,
            "hold_validation_rows": len(oot_df),
            "hold_validation_source": oot_source,
            "tuning_skipped": skip_tuning,
            "selected_action": selected_action,
            "seeded_from_uploaded_model": seeded_from_uploaded_model,
        }

        update_session(self.session_id, {
            "recalibration_result": result,
            "new_model_path": new_model_path,
            "oot_scores_path": oot_scores_path,
            "oot_scores_csv_path": oot_scores_csv_path,
            "processed_hold_path": processed_hold_path,
            "processed_hold_csv_path": processed_hold_csv_path,
            "processed_recal_train_path": processed_recal_train_path,
            "processed_recal_train_csv_path": processed_recal_train_csv_path,
            "oot_data_source": oot_source,
        })

        await self.completed(result)
        return result
