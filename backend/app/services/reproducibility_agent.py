import asyncio
import os
import importlib.util
import pandas as pd
import numpy as np
from scipy import stats
from typing import Any, Dict, Optional
from backend.app.services.base import Agent
from backend.app.utils.session import get_session, update_session
from backend.app.utils.model_helpers import TARGET_COL
from backend.app.utils.data_io import read_tabular_dataframe
from backend.app.utils.model_helpers import resolve_estimator
from backend.app.utils.oot_data import load_hold_dataframe, load_oos_dataframe
from backend.app.utils.processed_paths import (
    persist_processed_dataset,
    processed_data_dir,
    score_comparison_path,
    export_paths_payload,
)
from backend.app.config.datasets import DEV_DATA, HOLD_DATA, NEW_DATA, NEW_VALIDATION, ALL_DATASETS_PHRASE
from backend.app.config.agent_task_labels import (
    REPRO_APPLY_FEATURES,
    REPRO_APPLY_PREPROCESSING,
    REPRO_SCORE_DEV,
    REPRO_SCORE_HOLD,
    REPRO_SCORE_NEW,
    REPRO_SCORE_OOS,
)


class ReproducibilityAgent(Agent):
    def __init__(self, session_id: str, queue: asyncio.Queue):
        super().__init__("reproducibility", session_id, queue)
        self._declare_tasks([
            {"id": "apply_preprocessing", "name": REPRO_APPLY_PREPROCESSING},
            {"id": "apply_feature_engineering", "name": REPRO_APPLY_FEATURES},
            {"id": "score_dev_data", "name": REPRO_SCORE_DEV},
            {"id": "score_new_data", "name": REPRO_SCORE_NEW},
            {"id": "score_hold_data", "name": REPRO_SCORE_HOLD},
            {"id": "score_new_data_oos", "name": REPRO_SCORE_OOS},
            {"id": "predict_new_outcome", "name": "Finalize outcomes and persist artifacts"},
            {"id": "compare_to_original", "name": "Compare to original scores"},
            {"id": "evaluate_threshold", "name": "Evaluate reproducibility threshold"},
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
        processed_data_dir()
        dev_path = session.get("dev_data_path") or os.path.join(data_dir, "dev_sample.parquet")
        new_path = session.get("new_data_path") or os.path.join(data_dir, "new_sample.parquet")
        model_path = session.get("model_path") or os.path.join(data_dir, "card_response_v2.3.pkl")
        preprocess_path = session.get("preprocess_path") or os.path.join(data_dir, "preprocess.py")
        features_path = session.get("features_path") or os.path.join(data_dir, "feature_engineering.py")
        dev_scores_path = os.path.join(data_dir, "dev_scores.parquet")
        target_col = session.get("target_variable") or TARGET_COL
        outcome_col = session.get("outcome_variable") or target_col

        hold_df = load_hold_dataframe(session, data_dir)
        has_hold = hold_df is not None
        oos_df = load_oos_dataframe(session, data_dir)
        has_oos = oos_df is not None

        try:
            dev_df = read_tabular_dataframe(dev_path)
            new_df = read_tabular_dataframe(new_path)
        except Exception as e:
            await self.failed(f"Failed to load input data: {e}")
            return {}

        if has_hold:
            await self.log(f"{HOLD_DATA} loaded: {len(hold_df):,} rows from ingestion upload")
        else:
            await self.log(
                f"No {HOLD_DATA} uploaded — recalibration will fall back to {DEV_DATA} time-split"
            )
        if has_oos:
            await self.log(f"{NEW_VALIDATION} loaded: {len(oos_df):,} rows from ingestion upload")
        else:
            await self.log(f"No {NEW_VALIDATION} uploaded — scoring will be skipped")

        def _load_py_module(path: str, module_name: str):
            if not str(path).lower().endswith(".py"):
                raise ValueError(f"Only .py artifacts are supported: {path}")
            spec = importlib.util.spec_from_file_location(module_name, path)
            if spec is None or spec.loader is None:
                raise ImportError(f"Unable to load module from {path}")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod

        # Preprocess + FE already define the feature matrix; skip model-side get_dummies/align.
        skip_model_encoding = True

        async def _score_with_progress(label: str, model_obj, df: pd.DataFrame, feature_cols: list[str]) -> np.ndarray:
            from backend.app.utils.model_helpers import score_dataframe

            total = len(df)
            if total == 0:
                return np.asarray([], dtype=float)

            # Always chunk so each batch yields control back to event loop.
            chunk_size = min(2000, total)
            await self.log(f"{label} scoring in batches of {chunk_size:,} rows")

            outputs: list[np.ndarray] = []
            for start in range(0, total, chunk_size):
                end = min(start + chunk_size, total)
                chunk = df.iloc[start:end]
                chunk_scores = np.asarray(
                    await asyncio.to_thread(
                        score_dataframe,
                        model_obj,
                        chunk,
                        feature_cols,
                        skip_model_encoding=skip_model_encoding,
                    ),
                    dtype=float,
                )
                outputs.append(chunk_scores)
                await self.log(f"{label} scoring progress: {end:,}/{total:,}")

            return np.concatenate(outputs) if outputs else np.asarray([], dtype=float)

        async def _predict_with_progress(label: str, model_obj, df: pd.DataFrame, feature_cols: list[str]) -> np.ndarray:
            from backend.app.utils.model_helpers import predict_dataframe

            total = len(df)
            if total == 0:
                return np.asarray([], dtype=float)

            chunk_size = min(2000, total)
            outputs: list[np.ndarray] = []
            for start in range(0, total, chunk_size):
                end = min(start + chunk_size, total)
                chunk = df.iloc[start:end]
                chunk_preds = np.asarray(
                    await asyncio.to_thread(
                        predict_dataframe,
                        model_obj,
                        chunk,
                        feature_cols,
                        skip_model_encoding=skip_model_encoding,
                    )
                )
                outputs.append(chunk_preds)
                await self.log(f"{label} prediction progress: {end:,}/{total:,}")

            return np.concatenate(outputs) if outputs else np.asarray([], dtype=float)

        async def _ensure_unique_columns(df: pd.DataFrame, label: str) -> pd.DataFrame:
            cols = [str(c) for c in df.columns]
            seen: dict[str, int] = {}
            new_cols: list[str] = []
            changed = False
            for c in cols:
                idx = seen.get(c, 0)
                if idx == 0:
                    new_cols.append(c)
                else:
                    new_cols.append(f"{c}__dup{idx}")
                    changed = True
                seen[c] = idx + 1
            if changed:
                out = df.copy()
                out.columns = new_cols
                dup_count = len(cols) - len(set(cols))
                await self.log(f"{label}: renamed {dup_count} duplicate column name(s) for stability")
                return out
            return df

        async def _persist_processed(df: pd.DataFrame, dataset: str, label: str) -> dict[str, str]:
            paths = await asyncio.to_thread(
                persist_processed_dataset, df, self.session_id, dataset  # type: ignore[arg-type]
            )
            await self.log(f"{label}: {paths['csv']}")
            return paths

        # Task 1: apply_preprocessing
        await self.task_started("apply_preprocessing")
        await asyncio.sleep(0.8)
        try:
            mod = _load_py_module(preprocess_path, "preprocess_mod")
            processed_dev_df = await asyncio.to_thread(mod.preprocess, dev_df.copy())
            processed_new_df = await asyncio.to_thread(mod.preprocess, new_df.copy())
            processed_hold_df = None
            processed_oos_df = None
            if has_hold:
                processed_hold_df = await asyncio.to_thread(mod.preprocess, hold_df.copy())
            if has_oos:
                processed_oos_df = await asyncio.to_thread(mod.preprocess, oos_df.copy())
            if not isinstance(processed_dev_df, pd.DataFrame) or not isinstance(processed_new_df, pd.DataFrame):
                raise TypeError("preprocess() must return pandas DataFrame for both dev and new data")
            if has_hold and not isinstance(processed_hold_df, pd.DataFrame):
                raise TypeError("preprocess() must return pandas DataFrame for hold data")
            if has_oos and not isinstance(processed_oos_df, pd.DataFrame):
                raise TypeError("preprocess() must return pandas DataFrame for OOS data")
            hold_msg = f", hold={len(processed_hold_df):,}" if has_hold else ""
            oos_msg = f", oos={len(processed_oos_df):,}" if has_oos else ""
            await self.log(
                f"Preprocessing applied: dev={len(processed_dev_df):,} rows, new={len(processed_new_df):,} rows{hold_msg}{oos_msg}"
            )
            await self.log(
                f"Columns after preprocessing: dev={len(processed_dev_df.columns)}, "
                f"new={len(processed_new_df.columns)}"
                + (f", hold={len(processed_hold_df.columns)}" if has_hold else "")
                + (f", oos={len(processed_oos_df.columns)}" if has_oos else "")
            )
            await self.task_completed(
                "apply_preprocessing",
                f"{ALL_DATASETS_PHRASE} preprocessed: {len(processed_dev_df):,}/{len(processed_new_df):,}"
                + (f"/{len(processed_hold_df):,}" if has_hold else "")
                + (f"/{len(processed_oos_df):,}" if has_oos else ""),
            )
        except Exception as e:
            await self.log(f"Preprocessing warning: {e}, using raw data")
            processed_dev_df = dev_df.copy()
            processed_new_df = new_df.copy()
            processed_hold_df = hold_df.copy() if has_hold else None
            processed_oos_df = oos_df.copy() if has_oos else None
            await self.task_completed("apply_preprocessing", "Applied with fallback")

        # Task 2: apply_feature_engineering
        await self.task_started("apply_feature_engineering")
        await asyncio.sleep(0.6)
        try:
            mod = _load_py_module(features_path, "features_mod")
            feature_fn = getattr(mod, "derive_features", None) or getattr(mod, "feature_engineer", None)
            if feature_fn is None:
                raise AttributeError("No feature function found. Expected derive_features or feature_engineer")
            engineered_dev_df = await asyncio.to_thread(feature_fn, processed_dev_df.copy())
            engineered_new_df = await asyncio.to_thread(feature_fn, processed_new_df.copy())
            engineered_hold_df = None
            engineered_oos_df = None
            if has_hold and processed_hold_df is not None:
                engineered_hold_df = await asyncio.to_thread(feature_fn, processed_hold_df.copy())
            if has_oos and processed_oos_df is not None:
                engineered_oos_df = await asyncio.to_thread(feature_fn, processed_oos_df.copy())
            if not isinstance(engineered_dev_df, pd.DataFrame) or not isinstance(engineered_new_df, pd.DataFrame):
                raise TypeError("Feature function must return pandas DataFrame for both dev and new data")
            if has_hold and not isinstance(engineered_hold_df, pd.DataFrame):
                raise TypeError("Feature function must return pandas DataFrame for hold data")
            if has_oos and not isinstance(engineered_oos_df, pd.DataFrame):
                raise TypeError("Feature function must return pandas DataFrame for OOS data")
            if outcome_col in processed_dev_df.columns and outcome_col not in engineered_dev_df.columns:
                engineered_dev_df[outcome_col] = processed_dev_df[outcome_col].values
            if outcome_col in processed_new_df.columns and outcome_col not in engineered_new_df.columns:
                engineered_new_df[outcome_col] = processed_new_df[outcome_col].values
            if has_hold and engineered_hold_df is not None:
                if outcome_col in processed_hold_df.columns and outcome_col not in engineered_hold_df.columns:
                    engineered_hold_df[outcome_col] = processed_hold_df[outcome_col].values
                if target_col in processed_hold_df.columns and target_col not in engineered_hold_df.columns:
                    engineered_hold_df[target_col] = processed_hold_df[target_col].values
            if has_oos and engineered_oos_df is not None:
                if outcome_col in processed_oos_df.columns and outcome_col not in engineered_oos_df.columns:
                    engineered_oos_df[outcome_col] = processed_oos_df[outcome_col].values
                if target_col in processed_oos_df.columns and target_col not in engineered_oos_df.columns:
                    engineered_oos_df[target_col] = processed_oos_df[target_col].values
            if target_col in processed_new_df.columns and target_col not in engineered_new_df.columns:
                engineered_new_df[target_col] = processed_new_df[target_col].values
            engineered_dev_df = await _ensure_unique_columns(engineered_dev_df, "Dev engineered data")
            engineered_new_df = await _ensure_unique_columns(engineered_new_df, "New engineered data")
            if has_hold and engineered_hold_df is not None:
                engineered_hold_df = await _ensure_unique_columns(engineered_hold_df, "Hold engineered data")
            if has_oos and engineered_oos_df is not None:
                engineered_oos_df = await _ensure_unique_columns(engineered_oos_df, "OOS engineered data")
            new_features = [c for c in engineered_dev_df.columns if c not in processed_dev_df.columns]
            await self.log(f"Derived features: {new_features}")
            await self.task_completed(
                "apply_feature_engineering",
                f"Added {len(new_features)} engineered features ({DEV_DATA}, {NEW_DATA}, {HOLD_DATA})",
            )
        except Exception as e:
            await self.log(f"Feature engineering warning: {e}")
            engineered_dev_df = processed_dev_df.copy()
            engineered_new_df = processed_new_df.copy()
            engineered_hold_df = processed_hold_df.copy() if has_hold and processed_hold_df is not None else None
            engineered_oos_df = processed_oos_df.copy() if has_oos and processed_oos_df is not None else None
            await self.task_completed("apply_feature_engineering", "Applied with fallback")

        # Task 3: score_dev_data
        await self.task_started("score_dev_data")
        await asyncio.sleep(1.2)
        try:
            import joblib
            model = resolve_estimator(joblib.load(model_path))
            if skip_model_encoding:
                await self.log(
                    "Scoring uses engineered features as-is (encode_categoricals / align_columns skipped)"
                )
            excluded_feature_cols = {
                target_col,
                outcome_col,
                "predicted_outcome",
                "predict_proba",
                "predicted_proba",
            }
            dev_feature_cols = [c for c in engineered_dev_df.columns if c not in excluded_feature_cols]
            if hasattr(model, "feature_names_in_"):
                model_feature_cols = [str(c) for c in list(model.feature_names_in_)]
            elif hasattr(model, "get_booster") and model.get_booster() is not None and model.get_booster().feature_names:
                model_feature_cols = [str(c) for c in list(model.get_booster().feature_names)]
            else:
                model_feature_cols = dev_feature_cols
            common_model_cols = [c for c in model_feature_cols if c in engineered_dev_df.columns]
            if common_model_cols:
                scoring_cols = common_model_cols
                await self.log(f"Using {len(scoring_cols)} model-aligned columns for dev scoring")
            else:
                scoring_cols = dev_feature_cols
                await self.log(f"Model columns unavailable in dev data; using {len(scoring_cols)} detected columns")
            dev_scores = await _score_with_progress("Dev", model, engineered_dev_df, scoring_cols)
            dev_scored = len(dev_scores)
            await self.log(f"Dev scored {dev_scored:,} records")
            await self.log(f"Dev score range: [{dev_scores.min():.4f}, {dev_scores.max():.4f}]")
            await self.log(f"Dev mean score: {dev_scores.mean():.4f}")
            await self.task_completed(
                "score_dev_data",
                f"{dev_scored:,} {DEV_DATA} records scored | mean={dev_scores.mean():.3f}",
            )
        except Exception as e:
            await self.task_failed("score_dev_data", str(e))
            await self.failed(str(e))
            return {}

        # Task 4: score_new_data
        await self.task_started("score_new_data")
        await asyncio.sleep(0.9)
        try:
            new_feature_cols = [c for c in engineered_new_df.columns if c not in excluded_feature_cols]
            common_new_cols = [c for c in model_feature_cols if c in engineered_new_df.columns]
            scoring_cols = common_new_cols if common_new_cols else new_feature_cols
            new_scores = await _score_with_progress("New", model, engineered_new_df, scoring_cols)
            new_scored = len(new_scores)
            await self.log(f"New scored {new_scored:,} records")
            await self.log(f"New score range: [{new_scores.min():.4f}, {new_scores.max():.4f}]")
            await self.log(f"New mean score: {new_scores.mean():.4f}")
            await self.task_completed(
                "score_new_data",
                f"{new_scored:,} {NEW_DATA} records scored | mean={new_scores.mean():.3f}",
            )
        except Exception as e:
            await self.task_failed("score_new_data", str(e))
            await self.failed(str(e))
            return {}

        hold_scores = np.asarray([], dtype=float)
        if has_hold and engineered_hold_df is not None:
            await self.task_started("score_hold_data")
            await asyncio.sleep(0.9)
            try:
                hold_feature_cols = [c for c in engineered_hold_df.columns if c not in excluded_feature_cols]
                common_hold_cols = [c for c in model_feature_cols if c in engineered_hold_df.columns]
                hold_scoring_cols = common_hold_cols if common_hold_cols else hold_feature_cols
                hold_scores = await _score_with_progress(HOLD_DATA, model, engineered_hold_df, hold_scoring_cols)
                await self.log(f"{HOLD_DATA} scored {len(hold_scores):,} records")
                await self.log(f"Hold score range: [{hold_scores.min():.4f}, {hold_scores.max():.4f}]")
                await self.log(f"Hold mean score: {hold_scores.mean():.4f}")
                await self.task_completed(
                    "score_hold_data",
                    f"{len(hold_scores):,} {HOLD_DATA} records scored | mean={hold_scores.mean():.3f}",
                )
            except Exception as e:
                await self.task_failed("score_hold_data", str(e))
                await self.failed(str(e))
                return {}
        else:
            await self.task_completed("score_hold_data", f"Skipped (no {HOLD_DATA} uploaded)")

        oos_scores = np.asarray([], dtype=float)
        if has_oos and engineered_oos_df is not None:
            await self.task_started("score_new_data_oos")
            await asyncio.sleep(0.9)
            try:
                oos_feature_cols = [c for c in engineered_oos_df.columns if c not in excluded_feature_cols]
                common_oos_cols = [c for c in model_feature_cols if c in engineered_oos_df.columns]
                oos_scoring_cols = common_oos_cols if common_oos_cols else oos_feature_cols
                oos_scores = await _score_with_progress(NEW_VALIDATION, model, engineered_oos_df, oos_scoring_cols)
                await self.log(f"{NEW_VALIDATION} scored {len(oos_scores):,} records")
                await self.log(f"OOS score range: [{oos_scores.min():.4f}, {oos_scores.max():.4f}]")
                await self.log(f"OOS mean score: {oos_scores.mean():.4f}")
                await self.task_completed(
                    "score_new_data_oos",
                    f"{len(oos_scores):,} {NEW_VALIDATION} records scored | mean={oos_scores.mean():.3f}",
                )
            except Exception as e:
                await self.task_failed("score_new_data_oos", str(e))
                await self.failed(str(e))
                return {}
        else:
            await self.task_completed("score_new_data_oos", f"Skipped (no {NEW_VALIDATION} uploaded)")

        # Task 6: resolve outcomes and persist artifacts
        await self.task_started("predict_new_outcome")
        await asyncio.sleep(0.5)
        processed_hold_path = None
        processed_hold_csv_path = None
        processed_oos_path = None
        processed_oos_csv_path = None
        try:
            def _observed_outcome_series(df: pd.DataFrame, col: str) -> Optional[np.ndarray]:
                if col not in df.columns:
                    return None
                values = pd.to_numeric(df[col], errors="coerce")
                if values.notna().mean() < 0.5:
                    return None
                return np.asarray(values.fillna(0.0), dtype=float)

            new_outcome_source = "model_predicted"
            new_outcome_col_used = "predicted_outcome"
            observed_new = _observed_outcome_series(processed_new_df, outcome_col)
            if observed_new is None and target_col != outcome_col:
                observed_new = _observed_outcome_series(processed_new_df, target_col)
                if observed_new is not None:
                    new_outcome_col_used = target_col

            if observed_new is not None:
                new_outcome_source = "observed"
                if new_outcome_col_used == target_col:
                    await self.log(f"Using observed target column from new upload: {target_col}")
                else:
                    await self.log(f"Using observed outcome column from new upload: {outcome_col}")
                    new_outcome_col_used = outcome_col
                engineered_new_df[new_outcome_col_used] = observed_new[: len(engineered_new_df)]
                if is_regression:
                    predicted_mean = float(np.nanmean(observed_new))
                    predicted_rate = None
                else:
                    predicted_rate = float(np.nanmean(observed_new))
                    predicted_mean = None
            elif is_regression:
                generated = np.asarray(new_scores, dtype=float)
                engineered_new_df["predicted_outcome"] = generated
                new_outcome_col_used = "predicted_outcome"
                predicted_rate = None
                predicted_mean = float(np.nanmean(generated))
                await self.log(
                    "New upload has no numeric outcome column; using model scores as predicted_outcome"
                )
            else:
                generated = await _predict_with_progress("New outcome", model, engineered_new_df, scoring_cols)
                generated = np.asarray(generated, dtype=float)
                # Fallback when native predict is degenerate but scores are informative.
                if float(np.nanmean(generated)) <= 0.0 and float(np.nanmax(new_scores)) > float(np.nanmin(new_scores)):
                    thresholded = (np.asarray(new_scores, dtype=float) >= 0.5).astype(float)
                    if float(thresholded.mean()) > 0.0:
                        generated = thresholded
                        await self.log(
                            "model.predict returned all zeros; using score threshold (>=0.5) for predicted_outcome"
                        )
                engineered_new_df["predicted_outcome"] = generated
                predicted_rate = float(np.nanmean(generated))
                predicted_mean = None
                await self.log(
                    f"New upload has no outcome column; created model-generated column: predicted_outcome"
                )

            engineered_dev_df = engineered_dev_df.copy()
            engineered_new_df = engineered_new_df.copy()
            engineered_dev_df["score"] = np.nan_to_num(np.asarray(dev_scores, dtype=float), nan=0.0)
            engineered_new_df["score"] = np.nan_to_num(np.asarray(new_scores, dtype=float), nan=0.0)
            engineered_dev_df["predicted_proba"] = engineered_dev_df["score"]
            engineered_new_df["predicted_proba"] = engineered_new_df["score"]
            if has_hold and engineered_hold_df is not None and len(hold_scores) > 0:
                engineered_hold_df = engineered_hold_df.copy()
                engineered_hold_df["score"] = np.nan_to_num(np.asarray(hold_scores, dtype=float), nan=0.0)
                engineered_hold_df["predicted_proba"] = engineered_hold_df["score"]
                engineered_hold_df = await _ensure_unique_columns(engineered_hold_df, "Processed hold artifact")
                hold_paths = await _persist_processed(
                    engineered_hold_df, "hold", "Processed hold (OOT) artifact"
                )
                processed_hold_path = hold_paths["parquet"]
                processed_hold_csv_path = hold_paths["csv"]
            if has_oos and engineered_oos_df is not None and len(oos_scores) > 0:
                engineered_oos_df = engineered_oos_df.copy()
                engineered_oos_df["score"] = np.nan_to_num(np.asarray(oos_scores, dtype=float), nan=0.0)
                engineered_oos_df["predicted_proba"] = engineered_oos_df["score"]
                engineered_oos_df = await _ensure_unique_columns(engineered_oos_df, "Processed OOS artifact")
                oos_paths = await _persist_processed(engineered_oos_df, "oot", "Processed OOS artifact")
                processed_oos_path = oos_paths["parquet"]
                processed_oos_csv_path = oos_paths["csv"]

            engineered_dev_df = await _ensure_unique_columns(engineered_dev_df, "Processed dev artifact")
            engineered_new_df = await _ensure_unique_columns(engineered_new_df, "Processed new artifact")

            dev_paths = await _persist_processed(engineered_dev_df, "dev", "Processed dev artifact")
            new_paths = await _persist_processed(engineered_new_df, "new", "Processed new artifact")
            processed_dev_path = dev_paths["parquet"]
            processed_new_path = new_paths["parquet"]
            processed_dev_csv_path = dev_paths["csv"]
            processed_new_csv_path = new_paths["csv"]

            if is_regression:
                await self.log(f"New data outcome column: {new_outcome_col_used} ({new_outcome_source})")
                await self.log(f"Outcome mean: {predicted_mean:.4f}")
            else:
                await self.log(f"New data outcome column: {new_outcome_col_used} ({new_outcome_source})")
                await self.log(f"Positive rate: {predicted_rate*100:.2f}%")
            await self.log("Persisted processed dev/new artifacts for drift diagnostics")
            await self.task_completed(
                "predict_new_outcome",
                f"{new_outcome_col_used} ({new_outcome_source}) | "
                f"{'mean=' + format(predicted_mean, '.3f') if is_regression else 'rate=' + format(predicted_rate * 100, '.1f') + '%'}",
            )
        except Exception as e:
            await self.task_failed("predict_new_outcome", str(e))
            await self.failed(str(e))
            return {}

        # Task 6: compare_to_original
        await self.task_started("compare_to_original")
        await asyncio.sleep(0.8)
        comparison_available = False
        try:
            if os.path.exists(dev_scores_path):
                orig_scores_df = pd.read_parquet(dev_scores_path)
                orig_scores = orig_scores_df["score"].values[:len(dev_scores)]
                dev_scores_aligned = dev_scores[:len(orig_scores)]
                result_corr = stats.spearmanr(orig_scores, dev_scores_aligned)
                spearman_rho = float(result_corr.statistic)
                mean_abs_diff = float(np.mean(np.abs(orig_scores - dev_scores_aligned)))
                comparison_available = bool(np.isfinite(spearman_rho))
                if comparison_available:
                    await self.log(f"Spearman rank correlation: ρ = {spearman_rho:.4f}")
                    await self.log(f"Mean absolute difference: {mean_abs_diff:.6f}")
                    await self.task_completed("compare_to_original", f"ρ = {spearman_rho:.4f} | MAD = {mean_abs_diff:.6f}")
                else:
                    spearman_rho = None
                    mean_abs_diff = None
                    await self.log("Original score comparison unavailable (non-finite correlation result)")
                    await self.task_completed("compare_to_original", "Comparison unavailable")
            else:
                spearman_rho = None
                mean_abs_diff = None
                await self.log("Original scores reference not found — reproducibility comparison unavailable")
                await self.task_completed("compare_to_original", "Comparison unavailable")
        except Exception as e:
            await self.log(f"Comparison error: {e}")
            spearman_rho = None
            mean_abs_diff = None
            await self.task_completed("compare_to_original", "Comparison unavailable")

        # Task 7: evaluate_threshold
        await self.task_started("evaluate_threshold")
        await asyncio.sleep(0.4)
        threshold = 0.99
        passed = bool(spearman_rho is not None and spearman_rho >= threshold)
        if spearman_rho is None:
            verdict = "NOT_AVAILABLE"
            await self.log("Reproducibility threshold check skipped (no original score reference)")
            await self.task_completed("evaluate_threshold", "NOT AVAILABLE (no baseline)")
        elif passed:
            verdict = "PASS"
            await self.log(f"✓ Reproducibility check PASSED (ρ={spearman_rho:.4f} ≥ {threshold})")
            await self.log("Model can be re-scored from uploaded artifacts — pipeline is reproducible")
            await self.task_completed("evaluate_threshold", f"{verdict} (threshold={threshold})")
        else:
            verdict = "FAIL"
            await self.log(f"✗ Reproducibility check FAILED (ρ={spearman_rho:.4f} < {threshold})")
            await self.log("Investigate preprocessing discrepancies before proceeding")
            await self.task_completed("evaluate_threshold", f"{verdict} (threshold={threshold})")

        if is_regression:
            all_scores = np.concatenate([dev_scores, new_scores])
            low = float(np.nanpercentile(all_scores, 1))
            high = float(np.nanpercentile(all_scores, 99))
            if high <= low:
                high = low + 1.0
            score_bins = np.linspace(low, high, 11)
        else:
            score_bins = np.linspace(0, 1, 11)
        dev_hist, _ = np.histogram(dev_scores, bins=score_bins)
        new_hist, _ = np.histogram(new_scores, bins=score_bins)
        score_distribution = [
            {
                "bin": f"{score_bins[i]:.1f}-{score_bins[i+1]:.1f}",
                "dev_count": int(dev_hist[i]),
                "new_count": int(new_hist[i]),
            }
            for i in range(len(score_bins) - 1)
        ]

        result = {
            "comparison_available": comparison_available,
            "spearman_rho": round(float(spearman_rho), 6) if spearman_rho is not None else None,
            "mean_abs_diff": round(float(mean_abs_diff), 8) if mean_abs_diff is not None else None,
            "n_scored": int(dev_scored) if 'dev_scored' in locals() else 0,
            "dev_rows": int(len(engineered_dev_df)),
            "new_rows": int(len(engineered_new_df)),
            "hold_rows": int(len(engineered_hold_df)) if has_hold and engineered_hold_df is not None else 0,
            "oos_rows": int(len(engineered_oos_df)) if has_oos and engineered_oos_df is not None else 0,
            "dev_cols": int(len(engineered_dev_df.columns)),
            "new_cols": int(len(engineered_new_df.columns)),
            "hold_cols": int(len(engineered_hold_df.columns)) if has_hold and engineered_hold_df is not None else 0,
            "oot_source": "uploaded_hold" if has_hold else "dev_time_split",
            "dev_score_mean": round(float(dev_scores.mean()), 6),
            "new_score_mean": round(float(new_scores.mean()), 6),
            "dev_score_min": round(float(dev_scores.min()), 6),
            "dev_score_max": round(float(dev_scores.max()), 6),
            "new_score_min": round(float(new_scores.min()), 6),
            "new_score_max": round(float(new_scores.max()), 6),
            "hold_score_mean": round(float(hold_scores.mean()), 6) if len(hold_scores) > 0 else None,
            "hold_score_min": round(float(hold_scores.min()), 6) if len(hold_scores) > 0 else None,
            "hold_score_max": round(float(hold_scores.max()), 6) if len(hold_scores) > 0 else None,
            "oos_score_mean": round(float(oos_scores.mean()), 6) if len(oos_scores) > 0 else None,
            "dev_outcome_column": outcome_col,
            "selected_target_column": target_col,
            "selected_outcome_column": outcome_col,
            "new_outcome_column": new_outcome_col_used,
            "new_outcome_source": new_outcome_source,
            "new_outcome_rate": round(predicted_rate, 6) if predicted_rate is not None else None,
            "new_outcome_mean": round(predicted_mean, 6) if predicted_mean is not None else None,
            "new_predicted_outcome_rate": round(predicted_rate, 6) if predicted_rate is not None else None,
            "new_predicted_outcome_mean": round(predicted_mean, 6) if predicted_mean is not None else None,
            "model_features_used": model_feature_cols,
            "model_features_used_count": len(model_feature_cols),
            "score_distribution": score_distribution,
            "threshold": threshold,
            "passed": passed,
            "verdict": verdict,
            "problem_type": problem_type,
            "processed_export_paths": export_paths_payload(
                self.session_id,
                ["dev", "new"]
                + (["hold"] if has_hold and processed_hold_path else [])
                + (["oot"] if has_oos and processed_oos_path else []),
            ),
            "processed_dev_csv_path": processed_dev_csv_path,
            "processed_new_csv_path": processed_new_csv_path,
            "processed_hold_csv_path": processed_hold_csv_path,
            "processed_oos_csv_path": processed_oos_csv_path,
        }

        # Score comparison: platform score vs prediction column selected at ingestion
        from backend.app.utils.export_scores import (
            build_score_comparison,
            pick_reference_score_column,
            prepare_score_comparison_table,
            resolve_prediction_column,
            resolve_upload_reference_path,
        )
        prediction_col = resolve_prediction_column(session)
        reference_path = resolve_upload_reference_path(session, "dev")
        ref_df = read_tabular_dataframe(reference_path) if reference_path and os.path.exists(reference_path) else None
        if (
            prediction_col
            and reference_path
            and ref_df is not None
            and pick_reference_score_column(ref_df, prediction_col)
        ):
            try:
                comparison_df, comparison_summary = build_score_comparison(
                    processed_dev_path,
                    reference_path,
                    reference_score_col=prediction_col,
                )
                comparison_df = prepare_score_comparison_table(comparison_df)
                comparison_path = score_comparison_path(self.session_id, "dev")
                comparison_df.to_csv(comparison_path, index=False)
                result["score_comparison_summary"] = comparison_summary
                result["score_comparison_path"] = comparison_path
                await self.log(
                    f"Score comparison vs reference: {comparison_summary['rows_compared']:,} rows, "
                    f"corr={comparison_summary.get('correlation')}, "
                    f"mean_abs_diff={comparison_summary.get('mean_abs_diff')}"
                )
            except Exception as exc:
                await self.log(f"Score comparison skipped: {exc}")

        update_session(self.session_id, {"reproducibility_result": result})
        update_session(self.session_id, {
            "processed_dev_path": processed_dev_path,
            "processed_new_path": processed_new_path,
            "processed_hold_path": processed_hold_path if has_hold else None,
            "processed_oos_path": processed_oos_path if has_oos else None,
            "processed_dev_csv_path": processed_dev_csv_path,
            "processed_new_csv_path": processed_new_csv_path,
            "processed_hold_csv_path": processed_hold_csv_path,
            "processed_oos_csv_path": processed_oos_csv_path,
            "processed_data_dir": processed_data_dir(),
            "oot_data_source": "uploaded_hold" if has_hold else "dev_time_split",
            "processed_score_column": "score",
            "processed_dev_outcome_column": outcome_col,
            "processed_target_column": target_col,
            "processed_new_outcome_column": new_outcome_col_used,
            "score_comparison_path": result.get("score_comparison_path"),
            "uploaded_model_feature_names": model_feature_cols,
        })
        await self.completed(result)
        return result
