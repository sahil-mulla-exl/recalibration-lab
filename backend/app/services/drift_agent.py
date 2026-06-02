import asyncio
import os
from dataclasses import dataclass
from typing import Any, Dict, List

import numpy as np
import pandas as pd
from backend.app.core.governance import (
    classify_csi,
    classify_iv_delta,
    classify_missing_delta,
    load_governance,
)
from backend.app.services.base import Agent
from backend.app.utils.data_io import read_tabular_dataframe
from backend.app.utils.diagnostics_metrics import (
    compute_aucpr_logloss_brier,
    compute_bivariate_event_rate,
    compute_cardinality_drift,
    compute_classification_metrics,
    compute_csi_categorical_details,
    compute_csi_with_frozen_bins,
    compute_decile_event_rates,
    compute_descriptive_stats,
    compute_ks_curve_points,
    compute_missing_rate_drift,
    compute_rob_monotonicity,
    compute_roc_curve_points,
    compute_score_psi_frozen_deciles,
    compute_univariate_auc,
    compute_woe_iv_with_frozen_bins,
    find_optimal_thresholds,
)
from backend.app.utils.drift_metrics import (
    compute_auc,
    compute_calibration_by_decile,
    compute_gini,
    compute_ks_stat,
    compute_lift_by_decile,
    compute_mae,
    compute_r2,
    compute_rmse,
)
from backend.app.utils.interpretability import (
    compute_pdp_for_all_features,
    compute_shap_importance,
    compute_shap_shift_flags,
)
from backend.app.utils.model_features import resolve_session_model_features
from backend.app.utils.model_helpers import (
    TARGET_COL,
    load_model,
    resolve_estimator,
)
from backend.app.utils.session import get_session, update_session


@dataclass
class DiagnosticsContext:
    session: Dict[str, Any]
    governance: Dict[str, Any]
    requested_metrics: set[str]
    problem_type: str
    is_regression: bool
    score_col: str
    train_df: pd.DataFrame
    dev_oos_df: pd.DataFrame
    new_df: pd.DataFrame
    perf_new_df: pd.DataFrame
    perf_new_target_col: str
    raw_train_df: pd.DataFrame
    raw_new_df: pd.DataFrame
    train_target_col: str
    dev_target_col: str
    new_target_col: str
    feature_cols: List[str]
    model_path: str | None


class DriftDiagnosticsAgent(Agent):
    @staticmethod
    def _coerce_binary_target(series: pd.Series) -> pd.Series:
        numeric = pd.to_numeric(series, errors="coerce")
        if numeric.notna().mean() >= 0.7:
            return numeric.fillna(0.0).clip(lower=0.0, upper=1.0)

        text = series.astype(str).str.strip().str.lower()
        positive_tokens = {"1", "true", "yes", "y", "event", "bad", "default", "positive"}
        negative_tokens = {"0", "false", "no", "n", "non-event", "nonevent", "good", "negative"}
        mapped = pd.Series(np.nan, index=series.index, dtype=float)
        mapped[text.isin(positive_tokens)] = 1.0
        mapped[text.isin(negative_tokens)] = 0.0
        unresolved = mapped.isna()
        if unresolved.any():
            classes = [c for c in sorted(text[~text.isin({"", "nan", "none"})].unique().tolist()) if c]
            if len(classes) >= 2:
                positive_class = classes[-1]
                mapped[unresolved] = (text[unresolved] == positive_class).astype(float)
            else:
                mapped[unresolved] = 0.0
        return mapped.fillna(0.0).astype(float)

    @staticmethod
    def _infer_categorical_features_strict(df: pd.DataFrame, candidates: List[str]) -> List[str]:
        """Only true categorical columns from raw data (object/category/bool)."""
        cols: List[str] = []
        for col in candidates:
            if col not in df.columns:
                continue
            series = df[col]
            if (
                pd.api.types.is_object_dtype(series)
                or pd.api.types.is_categorical_dtype(series)
                or pd.api.types.is_bool_dtype(series)
            ):
                cols.append(col)
        return cols

    @staticmethod
    def _infer_categorical_features(df: pd.DataFrame, candidates: List[str]) -> List[str]:
        cols: List[str] = []
        for col in candidates:
            if col not in df.columns:
                continue
            series = df[col]
            if (
                pd.api.types.is_object_dtype(series)
                or pd.api.types.is_categorical_dtype(series)
                or pd.api.types.is_bool_dtype(series)
            ):
                cols.append(col)
                continue
            if pd.api.types.is_numeric_dtype(series):
                uniq = int(series.nunique(dropna=True))
                # Treat low-cardinality numeric flags/encoded levels as categorical.
                if 1 < uniq <= 20:
                    cols.append(col)
        return cols

    @staticmethod
    def _infer_numeric_features(df: pd.DataFrame, candidates: List[str]) -> List[str]:
        cols: List[str] = []
        for col in candidates:
            if col not in df.columns:
                continue
            if pd.api.types.is_numeric_dtype(df[col]):
                cols.append(col)
        return cols

    def __init__(self, session_id: str, queue: asyncio.Queue):
        super().__init__("drift", session_id, queue)
        self._declare_tasks(
            [
                {"id": "load_context", "name": "Load datasets, model and threshold"},
                {"id": "compute_data_drift", "name": "Compute data drift diagnostics"},
                {"id": "compute_concept_drift", "name": "Compute concept drift diagnostics"},
                {"id": "compute_performance_drift", "name": "Compute performance drift diagnostics"},
                {"id": "compute_interpretability", "name": "Compute interpretability diagnostics"},
                {"id": "assemble_report", "name": "Assemble report and recommendation"},
            ]
        )

    @staticmethod
    def _resolve_feature_columns(
        session: Dict[str, Any],
        train_df: pd.DataFrame,
        new_df: pd.DataFrame,
        score_col: str,
        train_target_col: str,
        dev_target_col: str,
        new_target_col: str,
    ) -> List[str]:
        return resolve_session_model_features(
            session,
            train_df,
            new_df,
            exclude={
                score_col,
                train_target_col,
                dev_target_col,
                new_target_col,
                "predicted_outcome",
            },
        )

    async def _emit_progress(self) -> None:
        total = max(len(self.tasks), 1)
        done = sum(1 for t in self.tasks if t.get("status") == "completed")
        await self.progress(done / total)

    async def run(self) -> Dict[str, Any]:
        await self.started()
        await self.task_started("load_context")
        try:
            await self.log("Loading processed datasets, thresholds, and model artifact…")
            ctx = await asyncio.to_thread(self._load_context)
            await self.log(
                f"Context ready · {len(ctx.feature_cols)} model features · "
                f"train={len(ctx.train_df):,} hold={len(ctx.dev_oos_df):,} "
                f"new_val={len(ctx.perf_new_df):,} new_data={len(ctx.new_df):,}"
            )
            await self.task_completed(
                "load_context",
                f"{len(ctx.feature_cols)} features from model · {len(ctx.requested_metrics)} metrics selected",
            )
            await self._emit_progress()
        except Exception as exc:
            await self.task_failed("load_context", str(exc))
            await self.failed(str(exc))
            return {}

        await self.task_started("compute_data_drift")
        await self.log("Computing target drift, CSI, cardinality (categorical raw), and missing rates…")
        data_drift = await asyncio.to_thread(self._run_data_drift, ctx)
        csi_count = len(data_drift.get("feature_csi", {}))
        await self.task_completed("compute_data_drift", f"CSI computed for {csi_count} model features")
        await self._emit_progress()

        await self.task_started("compute_concept_drift")
        await self.log("Computing IV, univariate AUC, and bivariate relationships from model features…")
        concept_drift = await asyncio.to_thread(self._run_concept_drift, ctx)
        await self.task_completed(
            "compute_concept_drift",
            f"IV/AUC on {len(concept_drift.get('iv', {}))} features · "
            f"bivariate on {len(concept_drift.get('bivariate_monotonicity', {}))} features",
        )
        await self._emit_progress()

        await self.task_started("compute_performance_drift")
        await self.log("Computing discrimination, stability, rank order, and classification metrics…")
        perf_drift = await asyncio.to_thread(self._run_performance_drift, ctx)
        await self.task_completed("compute_performance_drift", "Performance drift metrics complete")
        await self._emit_progress()

        await self.task_started("compute_interpretability")
        await self.log("Running SHAP importance and partial dependence plots…")
        interpretability = await asyncio.to_thread(self._run_interpretability, ctx)
        status = interpretability.get("status", "ok")
        await self.task_completed(
            "compute_interpretability",
            f"Interpretability {status}"
            + (f" · PDP on {len(interpretability.get('pdp_features', []))} features" if status == "ok" else ""),
        )
        await self._emit_progress()

        await self.task_started("assemble_report")
        await self.log("Building signal grid and recalibration recommendation…")
        signal = await asyncio.to_thread(
            self._build_signal_grid,
            data_drift,
            concept_drift,
            perf_drift,
            interpretability,
            ctx.governance,
        )
        recommendation = await asyncio.to_thread(self._recommend, signal)
        report = {
            "version": "v3",
            "problem_type": ctx.problem_type,
            "selected_metrics": sorted(list(ctx.requested_metrics)),
            "governance": ctx.governance,
            "datasets": {
                "training_rows": int(len(ctx.train_df)),
                "dev_oos_rows": int(len(ctx.dev_oos_df)),
                "perf_new_rows": int(len(ctx.perf_new_df)),
                "new_rows": int(len(ctx.new_df)),
                "score_column": ctx.score_col,
                "target_columns": {
                    "training": ctx.train_target_col,
                    "dev_oos": ctx.dev_target_col,
                    "perf_new": ctx.perf_new_target_col,
                    "new": ctx.new_target_col,
                },
            },
            "data_drift": data_drift,
            "concept_drift": concept_drift,
            "performance_drift": perf_drift,
            "interpretability": interpretability,
            "signal_grid": signal,
            "recommendation": recommendation,
        }
        report.update(self._legacy_compat_shape(report))
        update_session(self.session_id, {"drift_result": report})
        await self.task_completed("assemble_report", f"Action: {recommendation['action']}")
        await self.progress(1.0)
        await self.completed(report)
        return report

    def _load_context(self) -> DiagnosticsContext:
        session = get_session(self.session_id)
        if not session:
            raise ValueError("Session not found")
        requested_metrics = set(session.get("drift_metrics") or [])
        if not requested_metrics:
            raise ValueError("No drift metrics selected from inventory configuration.")
        model_entry = session.get("model_entry") or {}
        problem_type = str(model_entry.get("problem_type") or "classification").lower()
        is_regression = problem_type.startswith("reg")
        governance = load_governance(session)
        score_col = session.get("processed_score_column", "score")

        training_path = session.get("processed_training_path") or session.get("processed_dev_path")
        hold_path = session.get("processed_hold_path")
        oos_path = session.get("processed_oos_path")
        new_path = session.get("processed_new_path")
        if not training_path or not new_path:
            raise ValueError("Data processing artifacts missing. Run Data Processing agent first.")
        if not hold_path or not os.path.exists(hold_path):
            raise ValueError(
                "Development Validation Sample (hold) is required for performance diagnostics. "
                "Upload hold data and complete data processing."
            )
        if not oos_path or not os.path.exists(oos_path):
            raise ValueError(
                "New Validation Sample (OOS) is required for performance diagnostics. "
                "Upload new validation sample and complete data processing."
            )

        train_df = pd.read_parquet(training_path)
        dev_oos_df = pd.read_parquet(hold_path)
        perf_new_df = pd.read_parquet(oos_path)
        new_df = pd.read_parquet(new_path)
        if score_col not in dev_oos_df.columns or score_col not in perf_new_df.columns:
            raise ValueError(f"Score column '{score_col}' missing in validation sample datasets")
        if score_col not in new_df.columns:
            raise ValueError(f"Score column '{score_col}' missing in processed new data")

        target_col = session.get("target_variable") or session.get("processed_target_column") or TARGET_COL
        outcome_col = session.get("outcome_variable") or session.get("processed_dev_outcome_column") or target_col
        train_target_col = target_col if target_col in train_df.columns else outcome_col
        dev_target_col = target_col if target_col in dev_oos_df.columns else outcome_col
        if target_col in perf_new_df.columns:
            perf_new_target_col = target_col
        elif outcome_col in perf_new_df.columns:
            perf_new_target_col = outcome_col
        elif "predicted_outcome" in perf_new_df.columns:
            perf_new_target_col = "predicted_outcome"
        else:
            raise ValueError("New Validation Sample missing target/outcome columns")

        if target_col in new_df.columns:
            new_target_col = target_col
        elif outcome_col in new_df.columns:
            new_target_col = outcome_col
        elif "predicted_outcome" in new_df.columns:
            new_target_col = "predicted_outcome"
        else:
            raise ValueError("New Data processed artifact missing target/outcome columns")

        model_path = session.get("model_path")
        feature_cols = self._resolve_feature_columns(
            session,
            train_df,
            new_df,
            score_col,
            train_target_col,
            dev_target_col,
            new_target_col,
        )

        raw_train_path = session.get("dev_data_path") or training_path
        raw_new_path = session.get("new_data_path") or new_path
        raw_train_df = read_tabular_dataframe(raw_train_path)
        raw_new_df = read_tabular_dataframe(raw_new_path)

        return DiagnosticsContext(
            session=session,
            governance=governance,
            requested_metrics=requested_metrics,
            problem_type=problem_type,
            is_regression=is_regression,
            score_col=score_col,
            train_df=train_df,
            dev_oos_df=dev_oos_df,
            new_df=new_df,
            perf_new_df=perf_new_df,
            perf_new_target_col=perf_new_target_col,
            raw_train_df=raw_train_df,
            raw_new_df=raw_new_df,
            train_target_col=train_target_col,
            dev_target_col=dev_target_col,
            new_target_col=new_target_col,
            feature_cols=feature_cols,
            model_path=model_path,
        )

    def _run_data_drift(self, ctx: DiagnosticsContext) -> Dict[str, Any]:
        train_target = self._coerce_binary_target(ctx.train_df[ctx.train_target_col])
        new_target = self._coerce_binary_target(ctx.new_df[ctx.new_target_col])
        train_target_rate = float(train_target.mean())
        new_target_rate = float(new_target.mean())
        target_delta_pp = (new_target_rate - train_target_rate) * 100.0

        categorical_feature_cols = self._infer_categorical_features(ctx.train_df, ctx.feature_cols)
        csi_results: Dict[str, Any] = {}
        for col in ctx.feature_cols:
            if col in categorical_feature_cols:
                details = compute_csi_categorical_details(ctx.train_df[col], ctx.new_df[col])
            else:
                details = compute_csi_with_frozen_bins(ctx.train_df[col], ctx.new_df[col], n_bins=10)
            csi_results[col] = {
                "value": float(details.get("csi", 0.0)),
                "severity": classify_csi(float(details.get("csi", 0.0)), ctx.governance),
                "details": details,
            }

        raw_common = [c for c in ctx.feature_cols if c in ctx.raw_train_df.columns and c in ctx.raw_new_df.columns]
        categorical_cols = self._infer_categorical_features_strict(ctx.raw_train_df, raw_common)
        cardinality = {
            col: compute_cardinality_drift(ctx.raw_train_df[col], ctx.raw_new_df[col])
            for col in categorical_cols
        }
        missing = {}
        for col in ctx.feature_cols:
            if col not in ctx.raw_train_df.columns or col not in ctx.raw_new_df.columns:
                continue
            row = compute_missing_rate_drift(ctx.raw_train_df[col], ctx.raw_new_df[col])
            delta_pp = float(row.get("delta_pp", 0.0))
            row["severity"] = classify_missing_delta(delta_pp, ctx.governance)
            missing[col] = row

        desc_raw = {
            col: {
                "training": compute_descriptive_stats(ctx.raw_train_df[col]),
                "new": compute_descriptive_stats(ctx.raw_new_df[col]),
            }
            for col in ctx.feature_cols
            if col in ctx.raw_train_df.columns and col in ctx.raw_new_df.columns
        }
        desc_processed = {
            col: {
                "training": compute_descriptive_stats(ctx.train_df[col]),
                "new": compute_descriptive_stats(ctx.new_df[col]),
            }
            for col in ctx.feature_cols
        }
        target_breakdown: Dict[str, Any] = {}
        # Use processed categoricals (incl. low-cardinality numeric) and raw object columns
        breakdown_cols: List[str] = []
        for col in ctx.feature_cols:
            if col in categorical_feature_cols or col in categorical_cols:
                breakdown_cols.append(col)
        breakdown_cols = list(dict.fromkeys(breakdown_cols))[:25]

        for col in breakdown_cols:
            if col in ctx.train_df.columns and col in ctx.new_df.columns:
                train_segment_series = ctx.train_df[col]
                new_segment_series = ctx.new_df[col]
                train_target_series = self._coerce_binary_target(ctx.train_df[ctx.train_target_col])
                new_target_series = self._coerce_binary_target(ctx.new_df[ctx.new_target_col])
            else:
                if ctx.train_target_col not in ctx.raw_train_df.columns or ctx.new_target_col not in ctx.raw_new_df.columns:
                    continue
                train_segment_series = ctx.raw_train_df[col]
                new_segment_series = ctx.raw_new_df[col]
                train_target_series = self._coerce_binary_target(ctx.raw_train_df[ctx.train_target_col])
                new_target_series = self._coerce_binary_target(ctx.raw_new_df[ctx.new_target_col])
            train_seg = pd.DataFrame(
                {
                    "segment": train_segment_series.fillna("__NULL__").astype(str),
                    "target": train_target_series,
                }
            )
            new_seg = pd.DataFrame(
                {
                    "segment": new_segment_series.fillna("__NULL__").astype(str),
                    "target": new_target_series,
                }
            )
            train_grp = train_seg.groupby("segment", observed=True)["target"].agg(["count", "sum", "mean"])
            new_grp = new_seg.groupby("segment", observed=True)["target"].agg(["count", "sum", "mean"])
            segments = sorted(set(train_grp.index.tolist()) | set(new_grp.index.tolist()))
            rows: List[Dict[str, Any]] = []
            for seg in segments[:25]:
                train_count = int(float(train_grp["count"].get(seg, 0.0)))
                train_events = float(train_grp["sum"].get(seg, 0.0))
                train_rate = float(train_grp["mean"].get(seg, 0.0))
                new_count = int(float(new_grp["count"].get(seg, 0.0)))
                new_events = float(new_grp["sum"].get(seg, 0.0))
                new_rate = float(new_grp["mean"].get(seg, 0.0))
                rows.append(
                    {
                        "segment": seg,
                        "train_obs": train_count,
                        "new_obs": new_count,
                        "train_events": int(round(train_events)),
                        "new_events": int(round(new_events)),
                        "train_rate": train_rate,
                        "new_rate": new_rate,
                        "delta_pp": (new_rate - train_rate) * 100.0,
                    }
                )
            target_breakdown[col] = rows

        return {
            "target_drift": {
                "training_rate": train_target_rate,
                "new_rate": new_target_rate,
                "delta_pp": target_delta_pp,
                "breakdown": target_breakdown,
            },
            "feature_csi": csi_results,
            "cardinality_drift": cardinality,
            "missing_rate_drift": missing,
            "descriptive_stats": {"raw": desc_raw, "processed": desc_processed},
        }

    def _run_concept_drift(self, ctx: DiagnosticsContext) -> Dict[str, Any]:
        iv_by_feature: Dict[str, Any] = {}
        auc_uni: Dict[str, Any] = {}
        bivariate: Dict[str, Any] = {}
        y_train = self._coerce_binary_target(ctx.train_df[ctx.train_target_col]).astype(int)
        y_new = self._coerce_binary_target(ctx.new_df[ctx.new_target_col]).astype(int)
        numeric_cols = self._infer_numeric_features(ctx.train_df, ctx.feature_cols)
        for col in numeric_cols:
            iv = compute_woe_iv_with_frozen_bins(
                ctx.train_df[col], y_train, ctx.new_df[col], y_new, n_bins=10
            )
            iv_by_feature[col] = {
                "iv_train": float(iv["iv_train"]),
                "iv_new": float(iv["iv_new"]),
                "delta": float(iv["delta"]),
                "rating": classify_iv_delta(float(iv["delta"]), ctx.governance),
                "woe_train": iv["woe_train"],
                "woe_new": iv["woe_new"],
                "mono_train": bool(iv["mono_train"]),
                "mono_new": bool(iv["mono_new"]),
            }
            auc_uni[col] = {
                "train_auc": compute_univariate_auc(ctx.train_df[col], y_train),
                "new_auc": compute_univariate_auc(ctx.new_df[col], y_new),
            }
            bivariate[col] = compute_bivariate_event_rate(
                ctx.train_df[col], y_train, ctx.new_df[col], y_new, n_bins=10
            )
        return {
            "iv": iv_by_feature,
            "univariate_auc": auc_uni,
            "bivariate_monotonicity": bivariate,
        }

    def _run_performance_drift(self, ctx: DiagnosticsContext) -> Dict[str, Any]:
        dev_scores = pd.to_numeric(ctx.dev_oos_df[ctx.score_col], errors="coerce").fillna(0.0).to_numpy()
        new_scores = pd.to_numeric(ctx.perf_new_df[ctx.score_col], errors="coerce").fillna(0.0).to_numpy()
        dev_y = self._coerce_binary_target(ctx.dev_oos_df[ctx.dev_target_col]).to_numpy()
        new_y = self._coerce_binary_target(ctx.perf_new_df[ctx.perf_new_target_col]).to_numpy()

        if ctx.is_regression:
            return {
                "rmse_dev": compute_rmse(dev_y, dev_scores),
                "rmse_new": compute_rmse(new_y, new_scores),
                "mae_dev": compute_mae(dev_y, dev_scores),
                "mae_new": compute_mae(new_y, new_scores),
                "r2_dev": compute_r2(dev_y, dev_scores),
                "r2_new": compute_r2(new_y, new_scores),
            }

        dev_auc = compute_auc(dev_y, dev_scores)
        new_auc = compute_auc(new_y, new_scores)
        dev_ks = compute_ks_stat(dev_y, dev_scores)
        new_ks = compute_ks_stat(new_y, new_scores)
        score_psi = compute_score_psi_frozen_deciles(dev_scores, new_scores)
        aux_dev = compute_aucpr_logloss_brier(dev_y, dev_scores)
        aux_new = compute_aucpr_logloss_brier(new_y, new_scores)
        thresholds = find_optimal_thresholds(new_y, new_scores)
        base_threshold = float(ctx.session.get("classification_threshold") or 0.30)
        ks_threshold = float(thresholds["ks_optimal"])
        f1_threshold = float(thresholds["f1_optimal"])
        clf_dev = compute_classification_metrics(dev_y, dev_scores, base_threshold)
        clf_new = compute_classification_metrics(new_y, new_scores, base_threshold)
        classification_by_threshold = {
            "current": {
                "threshold": base_threshold,
                "dev": clf_dev,
                "new": clf_new,
            },
            "ks": {
                "threshold": ks_threshold,
                "dev": compute_classification_metrics(dev_y, dev_scores, ks_threshold),
                "new": compute_classification_metrics(new_y, new_scores, ks_threshold),
            },
            "f1": {
                "threshold": f1_threshold,
                "dev": compute_classification_metrics(dev_y, dev_scores, f1_threshold),
                "new": compute_classification_metrics(new_y, new_scores, f1_threshold),
            },
        }
        dev_lift = compute_lift_by_decile(dev_y, dev_scores)
        new_lift = compute_lift_by_decile(new_y, new_scores)
        dev_rates = compute_decile_event_rates(dev_y, dev_scores)
        new_rates = compute_decile_event_rates(new_y, new_scores)
        rob_dev = compute_rob_monotonicity(dev_rates)
        rob_new = compute_rob_monotonicity(new_rates)
        return {
            "auc_dev": dev_auc,
            "auc_new": new_auc,
            "auc_drop_pp": (dev_auc - new_auc) * 100.0,
            "ks_dev": dev_ks,
            "ks_new": new_ks,
            "ks_drop_pp": (dev_ks - new_ks) * 100.0,
            "gini_dev": compute_gini(dev_auc),
            "gini_new": compute_gini(new_auc),
            "auc_pr_dev": aux_dev["auc_pr"],
            "auc_pr_new": aux_new["auc_pr"],
            "log_loss_dev": aux_dev["log_loss"],
            "log_loss_new": aux_new["log_loss"],
            "brier_dev": aux_dev["brier"],
            "brier_new": aux_new["brier"],
            "score_psi": score_psi,
            "thresholds": thresholds,
            "classification_threshold": base_threshold,
            "classification_by_threshold": classification_by_threshold,
            "classification_dev": clf_dev,
            "classification_new": clf_new,
            "dev_lift_table": dev_lift,
            "new_lift_table": new_lift,
            "calibration_dev": compute_calibration_by_decile(dev_y, dev_scores),
            "calibration_new": compute_calibration_by_decile(new_y, new_scores),
            "rob_dev": rob_dev,
            "rob_new": rob_new,
            "roc_curve_dev": compute_roc_curve_points(dev_y, dev_scores, n=60),
            "roc_curve_new": compute_roc_curve_points(new_y, new_scores, n=60),
            "ks_curve_new": compute_ks_curve_points(new_y, new_scores, n=60),
            "decile_rates_dev": dev_rates,
            "decile_rates_new": new_rates,
        }

    def _run_interpretability(self, ctx: DiagnosticsContext) -> Dict[str, Any]:
        if not ctx.model_path:
            return {"status": "unavailable", "reason": "Model artifact path unavailable"}
        try:
            model = resolve_estimator(load_model(ctx.model_path))
        except Exception as exc:
            return {"status": "unavailable", "reason": f"Failed to load model: {exc}"}
        top_features = [
            c for c in ctx.feature_cols if c in ctx.dev_oos_df.columns and c in ctx.perf_new_df.columns
        ]
        if not top_features:
            return {"status": "unavailable", "reason": "No common feature columns for interpretability"}
        dev_X = ctx.dev_oos_df[top_features].copy()
        new_X = ctx.perf_new_df[top_features].copy()
        dev_shap = compute_shap_importance(model, dev_X)
        new_shap = compute_shap_importance(model, new_X)
        if not dev_shap or not new_shap:
            return {"status": "unavailable", "reason": "SHAP computation failed or unavailable"}

        shap_flags = compute_shap_shift_flags(
            dev_shap,
            new_shap,
            top_k=10,
            jaccard_min=float(ctx.governance["shap"]["jaccard_min"]),
            rank_shift_min_positions=int(ctx.governance["shap"]["rank_shift_min_positions"]),
            mass_drop_pp=float(ctx.governance["shap"]["mass_drop_pp"]),
        )
        # PDP for all one-hot features can stall diagnostics on wide datasets.
        # Limit PDP rendering to top importance features for responsive UX.
        ranked_features = sorted(
            top_features,
            key=lambda f: float(dev_shap.get(f, 0.0)) + float(new_shap.get(f, 0.0)),
            reverse=True,
        )
        pdp_features = ranked_features[:20]
        pdp_dev = compute_pdp_for_all_features(model, dev_X, pdp_features, n_grid=10)
        pdp_new = compute_pdp_for_all_features(model, new_X, pdp_features, n_grid=10)
        feature_types = {
            f: (
                "categorical"
                if f in self._infer_categorical_features_strict(ctx.train_df, [f])
                or f in self._infer_categorical_features(ctx.train_df, [f])
                else "numeric"
            )
            for f in pdp_features
        }
        return {
            "status": "ok",
            "shap_importance_dev": dev_shap,
            "shap_importance_new": new_shap,
            "shap_flags": shap_flags,
            "pdp_features": pdp_features,
            "pdp_feature_types": feature_types,
            "pdp_dev": pdp_dev,
            "pdp_new": pdp_new,
        }

    def _build_signal_grid(
        self,
        data_drift: Dict[str, Any],
        concept_drift: Dict[str, Any],
        perf_drift: Dict[str, Any],
        interpretability: Dict[str, Any],
        governance: Dict[str, Any],
    ) -> Dict[str, Any]:
        csi_values = [float(v["value"]) for v in data_drift["feature_csi"].values()]
        large_csi = (
            sum(1 for v in csi_values if classify_csi(v, governance) == "large")
            if csi_values
            else 0
        )
        iv_significant = sum(1 for v in concept_drift["iv"].values() if v["rating"] == "significant_decline")
        mono_breaks = sum(1 for v in concept_drift["bivariate_monotonicity"].values() if not v["mono_new"])
        missing_critical = sum(
            1
            for v in data_drift.get("missing_rate_drift", {}).values()
            if str(v.get("severity", "stable")) == "critical"
        )
        score_psi = perf_drift.get("score_psi", {}).get("psi", 0.0) if isinstance(perf_drift, dict) else 0.0
        return {
            "target_drift_pp": float(data_drift["target_drift"]["delta_pp"]),
            "feature_csi_large_count": int(large_csi),
            "missing_critical_count": int(missing_critical),
            "iv_significant_decline_count": int(iv_significant),
            "monotonicity_break_count": int(mono_breaks),
            "auc_drop_pp": float(perf_drift.get("auc_drop_pp", 0.0)),
            "ks_drop_pp": float(perf_drift.get("ks_drop_pp", 0.0)),
            "score_psi": float(score_psi),
            "shap_composite": interpretability.get("shap_flags", {}).get(
                "composite",
                interpretability.get("status", "unavailable"),
            ),
        }

    def _recommend(self, signal: Dict[str, Any]) -> Dict[str, Any]:
        concept_drift_present = signal["iv_significant_decline_count"] > 0 or signal["monotonicity_break_count"] > 0
        material_perf_drop = signal["auc_drop_pp"] >= 3.0 or signal["ks_drop_pp"] >= 5.0
        material_population_shift = signal["score_psi"] >= 0.25 or signal["feature_csi_large_count"] >= 2
        if concept_drift_present and (material_perf_drop or material_population_shift):
            action = "recal_with_hp_opt"
        elif material_population_shift or signal["target_drift_pp"] >= 2.0:
            action = "recal_same_hp"
        else:
            action = "no_action"

        action_messages = {
            "recal_with_hp_opt": (
                "Concept drift and/or a material performance drop were detected alongside population shift. "
                "Recalibrate with hyperparameter optimization to search for settings that restore discrimination "
                "and stability on the New Validation Sample."
            ),
            "recal_same_hp": (
                "Population or target drift was detected without severe concept breakdown. "
                "Recalibrate using the champion model's existing hyperparameters for a faster, controlled update "
                "on the current Development and New data."
            ),
            "no_action": (
                "Diagnostic signals are within acceptable bounds. Continue monitoring; recalibration is not required "
                "based on the current drift and performance thresholds."
            ),
        }
        signal_detail = (
            f"Supporting signals: target drift {signal['target_drift_pp']:.2f} pp, "
            f"{signal['feature_csi_large_count']} feature(s) with large CSI, "
            f"{signal['iv_significant_decline_count']} IV significant decline(s), "
            f"{signal['monotonicity_break_count']} monotonicity break(s), "
            f"AUC change {signal['auc_drop_pp']:.2f} pp, score PSI {signal['score_psi']:.3f}."
        )
        return {
            "action": action,
            "rationale": f"{action_messages[action]} {signal_detail}",
        }

    def _legacy_compat_shape(self, report: Dict[str, Any]) -> Dict[str, Any]:
        perf = report["performance_drift"]
        data = report["data_drift"]
        concept = report["concept_drift"]
        psi_value = float(perf.get("score_psi", {}).get("psi", 0.0))
        csi_results = {k: round(float(v["value"]), 4) for k, v in data["feature_csi"].items()}
        iv_results = {
            k: {
                "iv_dev": round(float(v["iv_train"]), 4),
                "iv_new": round(float(v["iv_new"]), 4),
                "delta_pct": round((float(v["delta"]) / max(abs(float(v["iv_train"])), 1e-6)) * 100.0, 2),
            }
            for k, v in concept["iv"].items()
        }
        monotonicity_breaks = [k for k, v in concept["bivariate_monotonicity"].items() if not v["mono_new"]]
        return {
            "overall_psi": round(psi_value, 4),
            "csi_results": csi_results,
            "iv_results": iv_results,
            "woe_results": {
                k: {"monotone_dev": v["mono_train"], "monotone_new": v["mono_new"]}
                for k, v in concept["iv"].items()
            },
            "monotonicity_breaks": monotonicity_breaks,
            "dev_target_rate": round(float(data["target_drift"]["training_rate"]), 4),
            "new_target_rate": round(float(data["target_drift"]["new_rate"]), 4),
            "target_rate_delta_pp": round(float(data["target_drift"]["delta_pp"]), 2),
            "orig_auc": round(float(perf.get("auc_dev", 0.0)), 4),
            "new_auc": round(float(perf.get("auc_new", 0.0)), 4),
            "auc_drop_pp": round(float(perf.get("auc_drop_pp", 0.0)), 2),
            "orig_ks": round(float(perf.get("ks_dev", 0.0)), 4),
            "new_ks": round(float(perf.get("ks_new", 0.0)), 4),
            "orig_gini": round(float(perf.get("gini_dev", 0.0)), 4),
            "new_gini": round(float(perf.get("gini_new", 0.0)), 4),
            "dev_lift_table": perf.get("dev_lift_table", []),
            "new_lift_table": perf.get("new_lift_table", []),
            "calibration_dev": perf.get("calibration_dev", []),
            "calibration_new": perf.get("calibration_new", []),
            "threshold_trace": {},
            "root_causes": [],
            "variable_distributions": {},
            "verdict": "recalibrate" if report["recommendation"]["action"] != "no_action" else "hold",
            "rationale": report["recommendation"]["rationale"],
            "rules_fired": [],
        }
