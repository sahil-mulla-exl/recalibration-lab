import asyncio
import os
import json
import numpy as np
import pandas as pd
from typing import Any, Dict, List, Optional
from backend.app.services.base import Agent
from backend.app.utils.session import get_session, update_session, session_dir
from backend.app.utils.model_features import resolve_session_model_features
from backend.app.utils.model_helpers import (
    TARGET_COL,
    build_xgboost_importance_comparison,
    get_xgboost_native_importance,
    score_dataframe,
    resolve_estimator,
)
from backend.app.utils.data_io import read_tabular_dataframe
from backend.app.utils.oot_data import load_oot_dataframe, load_oos_evaluation_dataframe
from backend.app.utils.diagnostics_metrics import (
    compute_aucpr_logloss_brier,
    compute_ks_curve_points,
    compute_rank_order_analysis,
)
from backend.app.utils.drift_metrics import (
    compute_auc, compute_ks_stat, compute_gini, compute_lift_by_decile, compute_calibration_by_decile,
    compute_rmse, compute_mae, compute_r2,
)
from backend.app.utils.inventory_metrics import (
    require_performance_metrics,
    wants_feature_importance,
)
from backend.app.core.governance import load_governance
from backend.app.utils.interpretability import (
    compute_shap_importance,
    compute_shap_shift_flags,
)
from backend.app.config.datasets import DEV_DATA, HOLD_DATA, NEW_DATA, NEW_VALIDATION
from backend.app.config.agent_task_labels import EVAL_SCORE_HOLDOUTS


class EvaluationAgent(Agent):
    def __init__(self, session_id: str, queue: asyncio.Queue):
        super().__init__("evaluation", session_id, queue)
        self._declare_tasks([
            {"id": "score_oot_with_original",     "name": EVAL_SCORE_HOLDOUTS},
            {"id": "compute_performance_metrics", "name": "Compute performance metrics (AUC, KS, lift)"},
            {"id": "compute_variable_experience", "name": "Compute variable importance comparison"},
            {"id": "compute_score_migration",     "name": "Score decile migration (champion vs recalibrated)"},
            {"id": "compute_top_decile_overlap",  "name": "Compute top-decile customer overlap (Jaccard)"},
            {"id": "assemble_export_artifacts",   "name": "Assemble export artifacts"},
        ])

    async def run(self) -> Dict[str, Any]:
        session = get_session(self.session_id)
        if not session:
            await self.failed("Session not found")
            return {}

        await self.started()

        try:
            selected_performance_metrics = require_performance_metrics(session)
        except ValueError as exc:
            await self.failed(str(exc))
            return {}
        await self.log(
            "Inventory performance metrics: " + ", ".join(selected_performance_metrics)
        )
        model_entry = session.get("model_entry") or {}
        problem_type = str(model_entry.get("problem_type") or "classification").lower()
        is_regression = problem_type.startswith("reg")

        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
        dev_path = session.get("dev_data_path") or os.path.join(data_dir, "dev_sample.parquet")
        model_path = session.get("model_path") or os.path.join(data_dir, "card_response_v2.3.pkl")
        new_model_path = session.get("new_model_path")
        oot_scores_path = session.get("oot_scores_path")
        target_col = session.get("target_variable") or session.get("processed_target_column") or TARGET_COL
        outcome_col = session.get("outcome_variable") or session.get("processed_dev_outcome_column") or target_col

        # Load original model
        import joblib
        orig_model = resolve_estimator(joblib.load(model_path))

        hold_df, hold_source = load_oot_dataframe(
            session, dev_path, data_dir=data_dir, prefer_processed=True
        )
        oos_df, oos_source = load_oos_evaluation_dataframe(
            session, data_dir, prefer_processed=True
        )
        await self.log(
            f"Evaluation cohorts: {HOLD_DATA}={hold_source} ({len(hold_df):,} rows), "
            f"{NEW_VALIDATION}={oos_source} ({len(oos_df):,} rows)"
        )

        y_hold = _resolve_y_vector(hold_df, target_col, outcome_col)
        y_oos = _resolve_y_vector(oos_df, target_col, outcome_col)

        # Load new model
        if new_model_path and os.path.exists(new_model_path):
            new_model = resolve_estimator(joblib.load(new_model_path))
        else:
            new_model = orig_model

        async def _score_with_progress(label: str, model_obj, df: pd.DataFrame, feature_cols: list[str]) -> np.ndarray:
            total = len(df)
            if total == 0:
                return np.asarray([], dtype=float)
            chunk_size = 10000 if total > 25000 else total
            outputs: list[np.ndarray] = []
            for start in range(0, total, chunk_size):
                end = min(start + chunk_size, total)
                chunk_scores = np.asarray(
                    await asyncio.to_thread(
                        score_dataframe,
                        model_obj,
                        df.iloc[start:end],
                        feature_cols,
                        skip_model_encoding=True,
                    ),
                    dtype=float,
                )
                outputs.append(chunk_scores)
                if chunk_size < total:
                    await self.log(f"{label} scoring progress: {end:,}/{total:,}")
            return np.concatenate(outputs) if outputs else np.asarray([], dtype=float)

        # ── Task 1: Score holdouts ───────────────────────────────────────
        await self.task_started("score_oot_with_original")
        await asyncio.sleep(0.8)
        hold_feature_cols = resolve_session_model_features(
            session,
            hold_df,
            exclude={target_col, outcome_col, TARGET_COL, "predicted_outcome"},
        )
        oos_feature_cols = resolve_session_model_features(
            session,
            oos_df,
            exclude={target_col, outcome_col, TARGET_COL, "predicted_outcome"},
        )
        await self.log(
            f"Scoring with {len(hold_feature_cols)} model features from .pkl ({HOLD_DATA}) · "
            f"{len(oos_feature_cols)} ({NEW_VALIDATION})"
        )
        champion_hold_scores = await _score_with_progress(
            f"Champion on {HOLD_DATA}", orig_model, hold_df, hold_feature_cols
        )
        champion_oos_scores = await _score_with_progress(
            f"Champion on {NEW_VALIDATION}", orig_model, oos_df, oos_feature_cols
        )
        recalibrated_oos_scores = _extract_recalibrated_scores(
            oos_df, oot_scores_path, len(oos_df)
        )
        if recalibrated_oos_scores is None:
            recalibrated_oos_scores = await _score_with_progress(
                f"Recalibrated on {NEW_VALIDATION}", new_model, oos_df, oos_feature_cols
            )

        await self.log(f"Champion scored {len(champion_hold_scores):,} rows on {HOLD_DATA}")
        await self.log(f"Champion scored {len(champion_oos_scores):,} rows on {NEW_VALIDATION}")
        await self.log(f"Recalibrated scored {len(recalibrated_oos_scores):,} rows on {NEW_VALIDATION}")
        await self.task_completed(
            "score_oot_with_original",
            f"{HOLD_DATA}={len(champion_hold_scores):,} | {NEW_VALIDATION}={len(recalibrated_oos_scores):,}",
        )

        champion_train_metrics: Dict[str, Any] = {}
        recal_train_metrics: Dict[str, Any] = {}
        recal_train_df = None
        recal_train_source = ""
        recal_train_path = session.get("processed_recal_train_path")
        if recal_train_path and os.path.exists(recal_train_path):
            recal_train_df = pd.read_parquet(recal_train_path)
            recal_train_source = "recalibration_training"
            train_feature_cols = resolve_session_model_features(
                session,
                recal_train_df,
                exclude={
                    target_col,
                    outcome_col,
                    TARGET_COL,
                    "predicted_outcome",
                    "predict_proba",
                    "predicted_proba",
                    "new_score",
                },
            )
            y_train_eval = _resolve_y_vector(recal_train_df, target_col, outcome_col)
            champion_train_scores = await _score_with_progress(
                f"Champion on {DEV_DATA}+{NEW_DATA}", orig_model, recal_train_df, train_feature_cols
            )
            recal_train_scores = _extract_recalibrated_scores(
                recal_train_df, None, len(recal_train_df)
            )
            if recal_train_scores is None:
                recal_train_scores = await _score_with_progress(
                    f"Recalibrated on {DEV_DATA}+{NEW_DATA}",
                    new_model,
                    recal_train_df,
                    train_feature_cols,
                )
            champion_train_metrics = _compute_cohort_metrics(
                y_train_eval, champion_train_scores, is_regression
            )
            recal_train_metrics = _compute_cohort_metrics(
                y_train_eval, recal_train_scores, is_regression
            )
            await self.log(
                f"Combined training cohort ({len(recal_train_df):,} rows): "
                f"champion vs recalibrated on appended {DEV_DATA} + {NEW_DATA}"
            )
            if not is_regression:
                await self.log(
                    f"Training AUC — champion: {champion_train_metrics.get('auc', 0):.4f} | "
                    f"recalibrated: {recal_train_metrics.get('auc', 0):.4f}"
                )

        await asyncio.sleep(0.5)

        # ── Task 2: Performance metrics ───────────────────────────────────
        await self.task_started("compute_performance_metrics")
        await asyncio.sleep(0.8)
        hold_metrics = _compute_cohort_metrics(y_hold, champion_hold_scores, is_regression)
        champion_oos_metrics = _compute_cohort_metrics(y_oos, champion_oos_scores, is_regression)
        recal_oos_metrics = _compute_cohort_metrics(y_oos, recalibrated_oos_scores, is_regression)

        orig_auc = champion_oos_metrics["auc"]
        new_auc = recal_oos_metrics["auc"]
        orig_ks = champion_oos_metrics["ks"]
        new_ks = recal_oos_metrics["ks"]
        orig_gini = champion_oos_metrics["gini"]
        new_gini = recal_oos_metrics["gini"]
        orig_rmse = champion_oos_metrics["rmse"]
        new_rmse = recal_oos_metrics["rmse"]
        orig_mae = champion_oos_metrics["mae"]
        new_mae = recal_oos_metrics["mae"]
        orig_r2 = champion_oos_metrics["r2"]
        new_r2 = recal_oos_metrics["r2"]
        orig_lift = champion_oos_metrics["lift_table"]
        new_lift = recal_oos_metrics["lift_table"]
        orig_cal = champion_oos_metrics["calibration"]
        new_cal = recal_oos_metrics["calibration"]
        orig_cal_error = champion_oos_metrics["cal_error"]
        new_cal_error = recal_oos_metrics["cal_error"]
        orig_roc = champion_oos_metrics["roc"]
        new_roc = recal_oos_metrics["roc"]
        champion_hold_roc = hold_metrics["roc"]

        if is_regression:
            rmse_delta = ((orig_rmse - new_rmse) / max(orig_rmse, 1e-6)) * 100
            await self.log(
                f"Champion (old holdout) RMSE: {hold_metrics['rmse']:.4f} | "
                f"Champion (new holdout) RMSE: {orig_rmse:.4f} | "
                f"Recalibrated (new holdout) RMSE: {new_rmse:.4f}"
            )
            await self.task_completed(
                "compute_performance_metrics",
                f"Recal RMSE {orig_rmse:.3f}→{new_rmse:.3f} on new holdout ({rmse_delta:+.2f}%)",
            )
            auc_delta = 0.0
        else:
            auc_delta = (new_auc - orig_auc) * 100
            hold_rob = hold_metrics.get("rank_order_break") or {}
            champ_rob = champion_oos_metrics.get("rank_order_break") or {}
            recal_rob = recal_oos_metrics.get("rank_order_break") or {}
            await self.log(
                f"Champion (old holdout) AUC: {hold_metrics['auc']:.4f} | "
                f"Champion (new holdout) AUC: {orig_auc:.4f} | "
                f"Recalibrated (new holdout) AUC: {new_auc:.4f} (Δ={auc_delta:+.2f}pp)"
            )
            await self.log(
                f"Rank-order breaks (non-decreasing decile transitions): "
                f"{HOLD_DATA} {hold_rob.get('non_decreasing_count', 0)}/{hold_rob.get('total_transitions', 0)} · "
                f"{NEW_VALIDATION} champion {champ_rob.get('non_decreasing_count', 0)}/{champ_rob.get('total_transitions', 0)} · "
                f"{NEW_VALIDATION} recalibrated {recal_rob.get('non_decreasing_count', 0)}/{recal_rob.get('total_transitions', 0)}"
            )
            await self.task_completed(
                "compute_performance_metrics",
                f"New holdout AUC {orig_auc:.3f}→{new_auc:.3f} (Δ={auc_delta:+.2f}pp)",
            )

        await asyncio.sleep(0.5)

        drift_result = session.get("drift_result") or {}
        guardrails = _evaluate_policy_guardrails(
            problem_type=problem_type,
            drift_result=drift_result,
            comparison_metrics={
                "orig_auc": orig_auc,
                "new_auc": new_auc,
                "orig_ks": orig_ks,
                "new_ks": new_ks,
                "orig_rmse": orig_rmse if is_regression else None,
                "new_rmse": new_rmse if is_regression else None,
                "orig_mae": orig_mae if is_regression else None,
                "new_mae": new_mae if is_regression else None,
                "orig_r2": orig_r2 if is_regression else None,
                "new_r2": new_r2 if is_regression else None,
                "jaccard": 0.0,  # updated after top-decile step for classification
            },
        )

        # ── Task 3: Variable importance ───────────────────────────────────
        await self.task_started("compute_variable_experience")
        await asyncio.sleep(0.7)
        importance_table: List[Dict[str, Any]] = []
        feature_cols = resolve_session_model_features(session)

        champion_gain = get_xgboost_native_importance(orig_model, feature_cols, "gain")
        recal_gain = get_xgboost_native_importance(new_model, feature_cols, "gain")
        comparison_gain = build_xgboost_importance_comparison(
            champion_gain,
            recal_gain,
            feature_cols,
        )
        if comparison_gain:
            top_champion = [r["feature"] for r in comparison_gain[:3]]
            top_recal = [
                r["feature"]
                for r in sorted(
                    comparison_gain,
                    key=lambda r: float(r["recal_importance"]),
                    reverse=True,
                )[:3]
            ]
            await self.log(
                f"XGBoost gain top-3 champion: {top_champion} | recalibrated: {top_recal}"
            )
        xgboost_importance: Dict[str, Any] = {
            "available": bool(champion_gain or recal_gain),
            "importance_type": "gain",
            "champion": champion_gain,
            "recalibrated": recal_gain,
            "comparison": comparison_gain,
        }

        shap_cols = [c for c in feature_cols if c in oos_df.columns]
        shap_frame = oos_df[shap_cols].copy() if shap_cols else pd.DataFrame()
        for col in shap_frame.columns:
            shap_frame[col] = pd.to_numeric(shap_frame[col], errors="coerce").fillna(0.0)

        def _compute_evaluation_shap() -> tuple[Dict[str, float], Dict[str, float]]:
            if shap_frame.empty:
                return {}, {}
            return (
                compute_shap_importance(orig_model, shap_frame),
                compute_shap_importance(new_model, shap_frame),
            )

        champion_shap, recal_shap = await asyncio.to_thread(_compute_evaluation_shap)
        comparison_shap = build_xgboost_importance_comparison(
            champion_shap,
            recal_shap,
            feature_cols,
        )
        shap_flags: Dict[str, Any] = {}
        if champion_shap and recal_shap:
            gov = load_governance(session)
            shap_gov = gov.get("shap") or {}
            shap_flags = compute_shap_shift_flags(
                champion_shap,
                recal_shap,
                top_k=10,
                jaccard_min=float(shap_gov.get("jaccard_min", 0.80)),
                rank_shift_min_positions=int(shap_gov.get("rank_shift_min_positions", 3)),
                mass_drop_pp=float(shap_gov.get("mass_drop_pp", 5.0)),
            )
        shap_importance: Dict[str, Any] = {
            "available": bool(champion_shap or recal_shap),
            "champion": champion_shap,
            "recalibrated": recal_shap,
            "comparison": comparison_shap,
            "shap_flags": shap_flags,
        }
        if comparison_shap:
            await self.log(
                "SHAP top-3 production: "
                f"{[r['feature'] for r in comparison_shap[:3]]} | recalibrated: "
                f"{[r['feature'] for r in sorted(comparison_shap, key=lambda r: float(r['recal_importance']), reverse=True)[:3]]}"
            )

        if wants_feature_importance(session):
            def _get_importance(model, cols):
                if hasattr(model, 'feature_importances_'):
                    feature_names = list(model.feature_names_in_) if hasattr(model, 'feature_names_in_') else cols
                    return dict(zip(feature_names, model.feature_importances_.tolist()))
                return {}

            orig_imp = _get_importance(orig_model, feature_cols)
            new_imp = _get_importance(new_model, feature_cols)

            sorted_features = sorted(feature_cols, key=lambda k: new_imp.get(k, 0), reverse=True)
            for feat in sorted_features[:18]:
                orig_v = orig_imp.get(feat, 0)
                new_v = new_imp.get(feat, 0)
                sign_stable = (orig_v > 0 and new_v > 0) or (orig_v == 0 and new_v == 0)
                importance_table.append({
                    "feature": feat,
                    "orig_importance": round(orig_v, 6),
                    "new_importance": round(new_v, 6),
                    "delta": round(new_v - orig_v, 6),
                    "sign_stable": sign_stable,
                })

            await self.log(f"Top-3 orig features: {[r['feature'] for r in sorted(importance_table, key=lambda x: -x['orig_importance'])[:3]]}")
            await self.log(f"Top-3 new features: {[r['feature'] for r in sorted(importance_table, key=lambda x: -x['new_importance'])[:3]]}")
            msg = f"{len(importance_table)} feature importances compared"
            if xgboost_importance["available"]:
                msg += " · XGBoost native gain"
            if shap_importance["available"]:
                msg += " · SHAP (prod vs recal)"
            await self.task_completed("compute_variable_experience", msg)
        else:
            if xgboost_importance["available"] or shap_importance["available"]:
                extras = []
                if xgboost_importance["available"]:
                    extras.append("XGBoost native gain")
                if shap_importance["available"]:
                    extras.append("SHAP prod vs recal")
                await self.log(
                    "Sklearn importance table skipped (inventory); " + " · ".join(extras)
                )
                await self.task_completed(
                    "compute_variable_experience",
                    " · ".join(extras) if extras else "Skipped",
                )
            else:
                await self.log(
                    "Feature Importance not in inventory; no XGBoost booster on champion model"
                )
                await self.task_completed(
                    "compute_variable_experience",
                    "Skipped (not in inventory configuration)",
                )

        await asyncio.sleep(0.5)

        # ── Task 4: Score migration matrix ────────────────────────────────
        await self.task_started("compute_score_migration")
        await asyncio.sleep(0.7)
        if is_regression:
            migration_matrix = np.zeros((0, 0), dtype=int)
            migration_pct = np.zeros((0, 0), dtype=float)
            diagonal_pct = 0.0
            await self.log("Score decile migration skipped for regression workflows")
            await self.task_completed("compute_score_migration", "Skipped (not applicable for regression)")
        else:
            orig_deciles = pd.qcut(pd.Series(champion_oos_scores).rank(method="first"), q=10, labels=False).values + 1
            new_deciles = pd.qcut(pd.Series(recalibrated_oos_scores).rank(method="first"), q=10, labels=False).values + 1

            migration_matrix = np.zeros((10, 10), dtype=int)
            for od, nd in zip(orig_deciles, new_deciles):
                migration_matrix[int(od) - 1][int(nd) - 1] += 1

            # Normalize rows
            migration_pct = (migration_matrix / migration_matrix.sum(axis=1, keepdims=True) * 100).round(1)
            await self.log(
                f"Decile migration matrix computed — {len(champion_oos_scores):,} accounts on {NEW_VALIDATION}"
            )
            diagonal_pct = np.diag(migration_pct).mean()
            await self.log(f"Same decile (diagonal avg): {diagonal_pct:.1f}%")
            adjacent_pct = np.mean([migration_pct[i, max(0,i-1):i+2].sum() - migration_pct[i,i] for i in range(10)])
            await self.log(f"Adjacent decile movement (avg): {adjacent_pct:.1f}%")
            await self.task_completed(
                "compute_score_migration",
                f"Decile migration · {diagonal_pct:.1f}% stayed in same decile (avg)",
            )

        await asyncio.sleep(0.4)

        # ── Task 5: Top-decile overlap ────────────────────────────────────
        await self.task_started("compute_top_decile_overlap")
        await asyncio.sleep(0.5)
        if is_regression:
            jaccard = 0.0
            await self.log("Top-decile overlap skipped for regression workflows")
            await self.task_completed("compute_top_decile_overlap", "Skipped (not applicable for regression)")
        else:
            top10_pct = int(len(champion_oos_scores) * 0.10)
            orig_top_idx = set(np.argsort(champion_oos_scores)[-top10_pct:])
            new_top_idx = set(np.argsort(recalibrated_oos_scores)[-top10_pct:])
            intersection = len(orig_top_idx & new_top_idx)
            union = len(orig_top_idx | new_top_idx)
            jaccard = intersection / max(union, 1)
            await self.log(f"Top-decile Jaccard overlap: {jaccard:.4f} ({jaccard*100:.1f}%)")
            await self.log(f"Intersection: {intersection:,} | Union: {union:,}")
            await self.task_completed("compute_top_decile_overlap", f"Jaccard = {jaccard:.3f} ({jaccard*100:.1f}%)")
        guardrails = _evaluate_policy_guardrails(
            problem_type=problem_type,
            drift_result=drift_result,
            comparison_metrics={
                "orig_auc": orig_auc,
                "new_auc": new_auc,
                "orig_ks": orig_ks,
                "new_ks": new_ks,
                "orig_rmse": orig_rmse if is_regression else None,
                "new_rmse": new_rmse if is_regression else None,
                "orig_mae": orig_mae if is_regression else None,
                "new_mae": new_mae if is_regression else None,
                "orig_r2": orig_r2 if is_regression else None,
                "new_r2": new_r2 if is_regression else None,
                "jaccard": jaccard,
            },
        )
        await self.log(
            f"Policy guardrails: {guardrails['status'].upper()} | "
            f"failed={len(guardrails['failed_rules'])}, warnings={len(guardrails['warning_rules'])}"
        )

        await asyncio.sleep(0.4)

        # ── Task 6: Assemble export artifacts ────────────────────────────
        await self.task_started("assemble_export_artifacts")
        await asyncio.sleep(0.6)
        sess_dir = session_dir(self.session_id)
        log_path = os.path.join(sess_dir, "recalibration_log.json")
        log_data = {
            "session_id": self.session_id,
            "problem_type": problem_type,
            "orig_auc": round(orig_auc, 4) if not is_regression else None,
            "new_auc": round(new_auc, 4) if not is_regression else None,
            "auc_delta_pp": round(auc_delta, 2) if not is_regression else None,
            "orig_ks": round(orig_ks, 4) if not is_regression else None,
            "new_ks": round(new_ks, 4) if not is_regression else None,
            "orig_rmse": round(orig_rmse, 6) if is_regression else None,
            "new_rmse": round(new_rmse, 6) if is_regression else None,
            "orig_mae": round(orig_mae, 6) if is_regression else None,
            "new_mae": round(new_mae, 6) if is_regression else None,
            "orig_r2": round(orig_r2, 6) if is_regression else None,
            "new_r2": round(new_r2, 6) if is_regression else None,
            "jaccard": round(jaccard, 4),
            "calibration_error_orig": round(float(orig_cal_error), 2),
            "calibration_error_new": round(float(new_cal_error), 2),
            "policy_guardrails": guardrails,
        }
        with open(log_path, "w") as f:
            json.dump(log_data, f, indent=2)
        await self.log(f"JSON log: {log_path}")
        await self.task_completed("assemble_export_artifacts", "JSON log + model .pkl ready for download")

        result = {
            "problem_type": problem_type,
            "selected_metrics": selected_performance_metrics,
            "inventory_metrics": sorted(list(session.get("evaluation_metrics") or session.get("drift_metrics") or [])),
            "evaluation_cohorts": {
                "champion_hold": _cohort_payload(hold_metrics, hold_source, len(hold_df)),
                "champion_oos": _cohort_payload(champion_oos_metrics, oos_source, len(oos_df)),
                "recalibrated_oos": _cohort_payload(recal_oos_metrics, oos_source, len(oos_df)),
                **(
                    {
                        "champion_train": _cohort_payload(
                            champion_train_metrics, recal_train_source, len(recal_train_df)
                        ),
                        "recalibrated_train": _cohort_payload(
                            recal_train_metrics, recal_train_source, len(recal_train_df)
                        ),
                    }
                    if recal_train_df is not None and len(recal_train_metrics) > 0
                    else {}
                ),
            },
            "recalibration_training_path": recal_train_path,
            "recalibration_training_rows": int(len(recal_train_df)) if recal_train_df is not None else 0,
            "hold_source": hold_source,
            "oos_source": oos_source,
            "orig_auc": round(orig_auc, 4),
            "new_auc": round(new_auc, 4),
            "orig_auc_pr": round(float(champion_oos_metrics.get("auc_pr") or 0.0), 4)
            if not is_regression
            else None,
            "new_auc_pr": round(float(recal_oos_metrics.get("auc_pr") or 0.0), 4)
            if not is_regression
            else None,
            "auc_delta_pp": round(auc_delta, 2),
            "orig_ks": round(orig_ks, 4),
            "new_ks": round(new_ks, 4),
            "orig_gini": round(orig_gini, 4),
            "new_gini": round(new_gini, 4),
            "orig_rmse": round(orig_rmse, 6) if is_regression else None,
            "new_rmse": round(new_rmse, 6) if is_regression else None,
            "orig_mae": round(orig_mae, 6) if is_regression else None,
            "new_mae": round(new_mae, 6) if is_regression else None,
            "orig_r2": round(orig_r2, 6) if is_regression else None,
            "new_r2": round(new_r2, 6) if is_regression else None,
            "champion_hold_auc": round(hold_metrics["auc"], 4) if not is_regression else None,
            "champion_hold_auc_pr": round(float(hold_metrics.get("auc_pr") or 0.0), 4)
            if not is_regression
            else None,
            "champion_hold_ks": round(hold_metrics["ks"], 4) if not is_regression else None,
            "champion_hold_gini": round(hold_metrics["gini"], 4) if not is_regression else None,
            "champion_hold_rmse": round(hold_metrics["rmse"], 6) if is_regression else None,
            "champion_hold_mae": round(hold_metrics["mae"], 6) if is_regression else None,
            "champion_hold_r2": round(hold_metrics["r2"], 6) if is_regression else None,
            "champion_hold_cal_error": round(float(hold_metrics["cal_error"]), 2),
            "champion_hold_lift_table": hold_metrics["lift_table"],
            "champion_hold_roc": champion_hold_roc,
            "champion_hold_ks_curve": hold_metrics.get("ks_curve") or [],
            "orig_ks_curve": champion_oos_metrics.get("ks_curve") or [],
            "new_ks_curve": recal_oos_metrics.get("ks_curve") or [],
            "champion_hold_rank_order_break": hold_metrics.get("rank_order_break") or {},
            "champion_oos_rank_order_break": champion_oos_metrics.get("rank_order_break") or {},
            "recalibrated_oos_rank_order_break": recal_oos_metrics.get("rank_order_break") or {},
            "champion_hold_decile_rates": hold_metrics.get("decile_rates") or [],
            "champion_oos_decile_rates": champion_oos_metrics.get("decile_rates") or [],
            "recalibrated_oos_decile_rates": recal_oos_metrics.get("decile_rates") or [],
            "champion_hold_rank_order_deciles": hold_metrics.get("rank_order_deciles") or [],
            "champion_oos_rank_order_deciles": champion_oos_metrics.get("rank_order_deciles") or [],
            "recalibrated_oos_rank_order_deciles": recal_oos_metrics.get("rank_order_deciles") or [],
            "top_decile_lift_champion_hold": round(
                hold_metrics["lift_table"][0]["lift"] if hold_metrics["lift_table"] else 0, 3
            ),
            "orig_cal_error": round(float(orig_cal_error), 2),
            "new_cal_error": round(float(new_cal_error), 2),
            "top_decile_lift_orig": round(orig_lift[0]["lift"] if orig_lift else 0, 3),
            "top_decile_lift_new": round(new_lift[0]["lift"] if new_lift else 0, 3),
            "jaccard": round(jaccard, 4),
            "migration_matrix": migration_matrix.tolist(),
            "migration_pct": migration_pct.tolist(),
            "importance_table": importance_table,
            "xgboost_importance": xgboost_importance,
            "shap_importance": shap_importance,
            "orig_lift_table": orig_lift,
            "new_lift_table": new_lift,
            "champion_hold_lift_table": hold_metrics["lift_table"],
            "orig_calibration": orig_cal,
            "new_calibration": new_cal,
            "orig_roc": orig_roc,
            "new_roc": new_roc,
            "champion_hold_roc": champion_hold_roc,
            "policy_guardrails": guardrails,
            "log_path": log_path,
        }

        await self.log("Generating AI evaluation insights…")
        try:
            from backend.app.services.genai_insights_service import enrich_evaluation_result

            result["genai_insights"] = await enrich_evaluation_result(result)
        except Exception as exc:
            await self.log(f"AI evaluation insights skipped: {exc}")

        update_session(self.session_id, {
            "evaluation_result": result,
            "log_path": log_path,
            "model_promotion_status": guardrails.get("status"),
            "model_promotion_guardrails": guardrails,
        })

        await self.completed(result)
        return result


def _resolve_y_vector(df: pd.DataFrame, target_col: str, outcome_col: str) -> np.ndarray:
    y_col = target_col if target_col in df.columns else (outcome_col if outcome_col in df.columns else None)
    if y_col is None:
        raise ValueError(
            f"Test data missing selected target/outcome columns: target='{target_col}', outcome='{outcome_col}'"
        )
    return df[y_col].values


def _extract_recalibrated_scores(
    oos_df: pd.DataFrame,
    oot_scores_path: Optional[str],
    expected_len: int,
) -> Optional[np.ndarray]:
    if "new_score" in oos_df.columns:
        return pd.to_numeric(oos_df["new_score"], errors="coerce").fillna(0.0).to_numpy()
    if oot_scores_path and os.path.exists(oot_scores_path):
        scored = pd.read_parquet(oot_scores_path)
        if "new_score" in scored.columns and len(scored) == expected_len:
            return pd.to_numeric(scored["new_score"], errors="coerce").fillna(0.0).to_numpy()
    return None


def _compute_cohort_metrics(y_true: np.ndarray, y_score: np.ndarray, is_regression: bool) -> Dict[str, Any]:
    if is_regression:
        return {
            "auc": 0.0,
            "ks": 0.0,
            "gini": 0.0,
            "rmse": compute_rmse(y_true, y_score),
            "mae": compute_mae(y_true, y_score),
            "r2": compute_r2(y_true, y_score),
            "lift_table": [],
            "calibration": [],
            "cal_error": 0.0,
            "roc": {"fpr": [], "tpr": []},
            "ks_curve": [],
            "auc_pr": 0.0,
            "decile_rates": [],
            "rank_order_deciles": [],
            "rank_order_break": {
                "non_decreasing_count": 0,
                "total_transitions": 0,
                "break_indices": [],
                "monotonicity_violations": [],
            },
        }
    auc = compute_auc(y_true, y_score)
    aux = compute_aucpr_logloss_brier(y_true, y_score)
    cal = compute_calibration_by_decile(y_true, y_score)
    rob_payload = compute_rank_order_analysis(y_true, y_score)
    return {
        "auc": auc,
        "auc_pr": float(aux.get("auc_pr") or 0.0),
        "ks": compute_ks_stat(y_true, y_score),
        "gini": compute_gini(auc),
        "rmse": 0.0,
        "mae": 0.0,
        "r2": 0.0,
        "lift_table": compute_lift_by_decile(y_true, y_score),
        "calibration": cal,
        "cal_error": float(np.mean([r["dev_pct"] for r in cal])) if cal else 0.0,
        "roc": _compute_roc(y_true, y_score),
        "ks_curve": compute_ks_curve_points(y_true, y_score, n=60),
        "decile_rates": rob_payload.get("decile_rates") or [],
        "rank_order_deciles": rob_payload.get("deciles") or [],
        "rank_order_break": rob_payload.get("rank_order_break") or {},
    }


def _cohort_payload(metrics: Dict[str, Any], source: str, rows: int) -> Dict[str, Any]:
    lift = metrics.get("lift_table") or []
    return {
        "source": source,
        "rows": int(rows),
        "auc": round(float(metrics.get("auc") or 0.0), 4),
        "auc_pr": round(float(metrics.get("auc_pr") or 0.0), 4),
        "ks": round(float(metrics.get("ks") or 0.0), 4),
        "gini": round(float(metrics.get("gini") or 0.0), 4),
        "rmse": round(float(metrics.get("rmse") or 0.0), 6),
        "mae": round(float(metrics.get("mae") or 0.0), 6),
        "r2": round(float(metrics.get("r2") or 0.0), 6),
        "cal_error": round(float(metrics.get("cal_error") or 0.0), 2),
        "top_decile_lift": round(lift[0]["lift"] if lift else 0.0, 3),
        "roc": metrics.get("roc") or {"fpr": [], "tpr": []},
        "ks_curve": metrics.get("ks_curve") or [],
        "lift_table": lift,
        "decile_rates": metrics.get("decile_rates") or [],
        "rank_order_deciles": metrics.get("rank_order_deciles") or [],
        "rank_order_break": metrics.get("rank_order_break") or {},
    }


def _compute_roc(y_true: np.ndarray, y_score: np.ndarray, n_points: int = 50) -> Dict:
    from sklearn.metrics import roc_curve
    fpr, tpr, _ = roc_curve(y_true, y_score)
    # Downsample for payload size
    step = max(1, len(fpr) // n_points)
    return {
        "fpr": [round(float(x), 4) for x in fpr[::step]],
        "tpr": [round(float(x), 4) for x in tpr[::step]],
    }


def _evaluate_policy_guardrails(problem_type: str, drift_result: Dict[str, Any], comparison_metrics: Dict[str, Any]) -> Dict[str, Any]:
    is_regression = str(problem_type).lower().startswith("reg")
    failed_rules: List[Dict[str, Any]] = []
    warning_rules: List[Dict[str, Any]] = []
    passed_rules: List[Dict[str, Any]] = []

    def register(rule_id: str, description: str, actual: str, threshold: str, severity: str, passed: bool):
        item = {
            "id": rule_id,
            "description": description,
            "actual": actual,
            "threshold": threshold,
            "severity": severity,
            "status": "pass" if passed else ("warn" if severity == "warning" else "fail"),
        }
        if passed:
            passed_rules.append(item)
        elif severity == "warning":
            warning_rules.append(item)
        else:
            failed_rules.append(item)

    psi_val = float(drift_result.get("overall_psi") or 0.0)
    register(
        "drift.psi.max",
        "Population shift must remain below blocking threshold",
        f"{psi_val:.3f}",
        "< 0.35",
        "critical",
        psi_val < 0.35,
    )

    if not is_regression:
        auc_delta_pp = (float(comparison_metrics.get("new_auc") or 0.0) - float(comparison_metrics.get("orig_auc") or 0.0)) * 100.0
        ks_delta = float(comparison_metrics.get("new_ks") or 0.0) - float(comparison_metrics.get("orig_ks") or 0.0)
        cal_err_new = float(drift_result.get("max_calibration_dev_pct") or 0.0)
        register(
            "performance.auc.delta",
            "AUC degradation cannot exceed 1.0pp",
            f"{auc_delta_pp:+.2f}pp",
            ">= -1.00pp",
            "critical",
            auc_delta_pp >= -1.0,
        )
        register(
            "performance.ks.delta",
            "KS degradation cannot exceed 0.03",
            f"{ks_delta:+.4f}",
            ">= -0.0300",
            "warning",
            ks_delta >= -0.03,
        )
        register(
            "calibration.max_error",
            "Calibration error must stay below 12%",
            f"{cal_err_new:.2f}%",
            "< 12.00%",
            "critical",
            cal_err_new < 12.0,
        )
        jaccard = float(comparison_metrics.get("jaccard") or 0.0)
        register(
            "ranking.top_decile_overlap",
            "Top-decile overlap should stay above 0.30",
            f"{jaccard:.3f}",
            ">= 0.300",
            "warning",
            jaccard >= 0.30,
        )
    else:
        orig_rmse = float(comparison_metrics.get("orig_rmse") or 0.0)
        new_rmse = float(comparison_metrics.get("new_rmse") or 0.0)
        orig_mae = float(comparison_metrics.get("orig_mae") or 0.0)
        new_mae = float(comparison_metrics.get("new_mae") or 0.0)
        orig_r2 = float(comparison_metrics.get("orig_r2") or 0.0)
        new_r2 = float(comparison_metrics.get("new_r2") or 0.0)
        rmse_delta_pct = ((new_rmse - orig_rmse) / max(orig_rmse, 1e-6)) * 100.0
        mae_delta_pct = ((new_mae - orig_mae) / max(orig_mae, 1e-6)) * 100.0
        r2_delta = new_r2 - orig_r2
        register(
            "performance.rmse.delta_pct",
            "RMSE increase cannot exceed 5%",
            f"{rmse_delta_pct:+.2f}%",
            "<= +5.00%",
            "critical",
            rmse_delta_pct <= 5.0,
        )
        register(
            "performance.mae.delta_pct",
            "MAE increase cannot exceed 7.5%",
            f"{mae_delta_pct:+.2f}%",
            "<= +7.50%",
            "warning",
            mae_delta_pct <= 7.5,
        )
        register(
            "performance.r2.delta",
            "R2 drop cannot exceed 0.03",
            f"{r2_delta:+.4f}",
            ">= -0.0300",
            "critical",
            r2_delta >= -0.03,
        )

    if failed_rules:
        status = "block"
    elif warning_rules:
        status = "warn"
    else:
        status = "pass"
    return {
        "status": status,
        "failed_rules": failed_rules,
        "warning_rules": warning_rules,
        "passed_rules": passed_rules,
        "override_allowed": status == "warn",
        "required_approvers": ["model_owner", "risk_approver"] if status != "pass" else ["model_owner"],
    }
