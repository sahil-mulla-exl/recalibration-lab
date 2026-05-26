import asyncio
import os
import importlib.util
from typing import Any, Dict, Optional
from backend.app.services.base import Agent
from backend.app.utils.session import get_session, update_session
from backend.app.utils.data_io import read_tabular_dataframe
from backend.app.services.recalibration_agent import (
    _extract_base_params_from_uploaded_model,
    _resolve_grid_key,
)
from backend.app.utils.model_helpers import (
    extract_model_feature_names,
    extract_model_metadata,
    resolve_estimator,
)


class IngestionAgent(Agent):
    def __init__(self, session_id: str, queue: asyncio.Queue):
        super().__init__("ingestion", session_id, queue)
        self._declare_tasks([
            {"id": "parse_dev_data", "name": "Parse Development Data"},
            {"id": "parse_new_data", "name": "Parse New Data"},
            {"id": "parse_hold_data", "name": "Parse Development Validation Sample"},
            {"id": "refinement", "name": "Refinement — reconcile dataset schemas"},
            {"id": "parse_new_data_oos", "name": "Parse New Validation Sample"},
            {"id": "load_model_object", "name": "Load model object"},
            {"id": "validate_preprocessing_code", "name": "Validate preprocessing code"},
            {"id": "validate_feature_engineering_code", "name": "Validate feature engineering code"},
        ])

    async def run(self) -> Dict[str, Any]:
        session = get_session(self.session_id)
        if not session:
            await self.failed("Session not found")
            return {}

        await self.started()

        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
        dev_path = session.get("dev_data_path") or os.path.join(data_dir, "dev_sample.parquet")
        new_path = session.get("new_data_path") or os.path.join(data_dir, "new_sample.parquet")
        hold_path = session.get("hold_data_path") or os.path.join(data_dir, "hold_sample.parquet")
        oos_path = session.get("new_data_oos_path") or os.path.join(data_dir, "oos_sample.parquet")
        model_path = session.get("model_path") or os.path.join(data_dir, "card_response_v2.3.pkl")
        preprocess_path = session.get("preprocess_path") or os.path.join(data_dir, "preprocess.py")
        features_path = session.get("features_path") or os.path.join(data_dir, "feature_engineering.py")
        target_col = session.get("target_variable") or "responded_to_offer"

        def _load_py_module(path: str, module_name: str):
            if not str(path).lower().endswith(".py"):
                raise ValueError(f"Only .py artifacts are supported: {path}")
            spec = importlib.util.spec_from_file_location(module_name, path)
            if spec is None or spec.loader is None:
                raise ImportError(f"Unable to load module from {path}")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod

        async def _parse_dataset(task_id: str, path: str, label: str) -> tuple[int, int, Any]:
            await self.task_started(task_id)
            await asyncio.sleep(0.5)
            try:
                df = read_tabular_dataframe(path)
                rows, cols = df.shape
                await self.log(f"{label}: {rows:,} rows × {cols} columns")
                if target_col in df.columns:
                    await self.log(f"Target rate ({target_col}): {df[target_col].mean()*100:.1f}%")
                else:
                    await self.log(f"Target column not found in {label.lower()}: {target_col}")
                await self.task_completed(task_id, f"{rows:,} rows × {cols} cols")
                return rows, cols, df
            except Exception as e:
                await self.task_failed(task_id, str(e))
                raise

        try:
            dev_rows, dev_cols, dev_df = await _parse_dataset("parse_dev_data", dev_path, "Dev data")
            new_rows, new_cols, new_df = await _parse_dataset("parse_new_data", new_path, "New data")
            hold_rows, hold_cols, hold_df = await _parse_dataset("parse_hold_data", hold_path, "Hold data")
        except Exception as e:
            await self.failed(str(e))
            return {}

        # Refinement: schema reconciliation across the first three datasets
        await self.task_started("refinement")
        await asyncio.sleep(0.5)
        dev_cols_set = set(dev_df.columns)
        new_cols_set = set(new_df.columns)
        hold_cols_set = set(hold_df.columns)
        common_dev_new = dev_cols_set & new_cols_set
        common_all = dev_cols_set & new_cols_set & hold_cols_set
        only_in_dev = dev_cols_set - new_cols_set - hold_cols_set
        only_in_new = new_cols_set - dev_cols_set
        only_in_hold = hold_cols_set - dev_cols_set
        await self.log(f"Dev ∩ New shared columns: {len(common_dev_new)}")
        await self.log(f"Dev ∩ New ∩ Hold shared columns: {len(common_all)}")
        if only_in_dev:
            await self.log(f"Only in dev: {list(only_in_dev)[:8]}{'…' if len(only_in_dev) > 8 else ''}")
        if only_in_new:
            await self.log(f"Only in new: {list(only_in_new)[:8]}{'…' if len(only_in_new) > 8 else ''}")
        if only_in_hold:
            await self.log(f"Only in hold: {list(only_in_hold)[:8]}{'…' if len(only_in_hold) > 8 else ''}")
        await self.log("Refinement complete — dev, new, and hold schemas compared")
        await self.task_completed(
            "refinement",
            f"{len(common_all)} columns shared across 3 datasets",
        )

        try:
            oos_rows, oos_cols, oos_df = await _parse_dataset("parse_new_data_oos", oos_path, "New data OOS")
        except Exception as e:
            await self.failed(str(e))
            return {}

        oos_vs_dev = len(dev_cols_set & set(oos_df.columns))
        await self.log(f"OOS columns aligned with dev: {oos_vs_dev}")

        uploaded_hp: Dict[str, Any] = {}
        uploaded_feature_names: List[str] = []

        # Task: load_model_object
        await self.task_started("load_model_object")
        await asyncio.sleep(0.8)
        try:
            import joblib
            loaded_model = joblib.load(model_path)
            model = resolve_estimator(loaded_model)
            model_meta = extract_model_metadata(loaded_model)
            model_class = model_meta.get("model_class", type(model).__name__)
            n_features = model_meta.get("feature_count", "?")
            await self.log(f"Model class: {model_class}")
            await self.log(f"Features: {n_features}")
            if model_meta.get("n_estimators") is not None:
                await self.log(f"n_estimators: {model_meta['n_estimators']}")
            grid_key = _resolve_grid_key(str(model_class))
            uploaded_hp = _extract_base_params_from_uploaded_model(model_path, grid_key)
            uploaded_feature_names = extract_model_feature_names(loaded_model)
            if uploaded_feature_names:
                await self.log(f"Model features from .pkl: {len(uploaded_feature_names)} columns")
            else:
                await self.log("Warning: uploaded .pkl exposes no feature names")
            if uploaded_hp:
                await self.log(f"Champion hyperparameters from .pkl: {uploaded_hp}")
            else:
                await self.log("No supported hyperparameters found in uploaded .pkl (library defaults will apply if tuning is skipped)")
            await self.task_completed("load_model_object", f"{model_class} | {n_features} features")
        except Exception as e:
            await self.task_failed("load_model_object", str(e))
            await self.failed(str(e))
            return {}

        await self.task_started("validate_preprocessing_code")
        await asyncio.sleep(0.4)
        try:
            mod = _load_py_module(preprocess_path, "preprocess_mod")
            required_fns = ["impute_missing", "cap_outliers", "handle_special_values", "preprocess"]
            found = [f for f in required_fns if hasattr(mod, f)]
            missing = [f for f in required_fns if f not in found]
            if missing:
                await self.log(f"Warning: missing functions: {missing}")
            await self.log(f"Found functions: {found}")
            await self.task_completed("validate_preprocessing_code", f"{len(found)}/{len(required_fns)} functions valid")
        except Exception as e:
            await self.log(f"Warning: {e}")
            await self.task_completed("validate_preprocessing_code", "Validated with warnings")

        await self.task_started("validate_feature_engineering_code")
        await asyncio.sleep(0.4)
        try:
            mod = _load_py_module(features_path, "features_mod")
            required_fns = ["derive_features", "feature_engineer"]
            found = [f for f in required_fns if hasattr(mod, f)]
            await self.log(f"Found functions: {found}")
            await self.task_completed("validate_feature_engineering_code", f"{len(found)} feature engineering functions valid")
        except Exception as e:
            await self.log(f"Warning: {e}")
            await self.task_completed("validate_feature_engineering_code", "Validated with warnings")

        result = {
            "dev_rows": dev_rows,
            "dev_cols": dev_cols,
            "new_rows": new_rows,
            "new_cols": new_cols,
            "hold_rows": hold_rows,
            "hold_cols": hold_cols,
            "oos_rows": oos_rows,
            "oos_cols": oos_cols,
            "model_class": model_class,
            "feature_count": n_features,
            "common_columns": len(common_all),
            "oos_dev_common_columns": oos_vs_dev,
            "dev_target_rate": round(float(dev_df[target_col].mean()), 4) if target_col in dev_df.columns else None,
            "new_target_rate": round(float(new_df[target_col].mean()), 4) if target_col in new_df.columns else None,
            "hold_target_rate": round(float(hold_df[target_col].mean()), 4) if target_col in hold_df.columns else None,
            "oos_target_rate": round(float(oos_df[target_col].mean()), 4) if target_col in oos_df.columns else None,
        }

        update_session(
            self.session_id,
            {
                "ingestion_result": result,
                "dev_data_path": dev_path,
                "new_data_path": new_path,
                "hold_data_path": hold_path,
                "new_data_oos_path": oos_path,
                "model_path": model_path,
                "preprocess_path": preprocess_path,
                "features_path": features_path,
                "uploaded_model_hyperparameters": uploaded_hp,
                "uploaded_model_feature_names": uploaded_feature_names,
            },
        )

        await self.completed(result)
        return result
