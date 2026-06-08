"""Compact JSON payloads for GenAI prompts (metrics only, no raw curves)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _top_csi(feature_csi: Dict[str, Any], n: int = 10) -> List[Dict[str, Any]]:
    rows = [
        {"feature": k, "csi": round(float(v.get("value", 0.0)), 4), "severity": v.get("severity")}
        for k, v in feature_csi.items()
        if isinstance(v, dict)
    ]
    rows.sort(key=lambda r: r["csi"], reverse=True)
    return rows[:n]


def _segment_hotspots(target_breakdown: Dict[str, Any], n: int = 3) -> List[Dict[str, Any]]:
    hotspots: List[Dict[str, Any]] = []
    for feature, segments in target_breakdown.items():
        if not isinstance(segments, list):
            continue
        for row in segments:
            if not isinstance(row, dict):
                continue
            hotspots.append(
                {
                    "feature": feature,
                    "segment": row.get("segment"),
                    "delta_pp": round(float(row.get("delta_pp", 0.0)), 2),
                    "train_rate": round(float(row.get("train_rate", 0.0)), 4),
                    "new_rate": round(float(row.get("new_rate", 0.0)), 4),
                }
            )
    hotspots.sort(key=lambda r: abs(float(r["delta_pp"])), reverse=True)
    return hotspots[:n]


def _cardinality_flags(cardinality: Dict[str, Any]) -> List[Dict[str, Any]]:
    flags: List[Dict[str, Any]] = []
    for feature, row in cardinality.items():
        if not isinstance(row, dict):
            continue
        new_only = row.get("new_only") or row.get("new_categories") or []
        lost = row.get("lost") or row.get("lost_categories") or []
        if new_only or lost:
            flags.append(
                {
                    "feature": feature,
                    "new_only": list(new_only)[:10],
                    "lost": list(lost)[:10],
                    "train_count": row.get("train_count"),
                    "new_count": row.get("new_count"),
                }
            )
    return flags[:25]


def _missing_critical(missing: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for feature, row in missing.items():
        if not isinstance(row, dict):
            continue
        if str(row.get("severity", "")).lower() == "critical":
            rows.append(
                {
                    "feature": feature,
                    "delta_pp": round(float(row.get("delta_pp", 0.0)), 2),
                    "train_missing_pct": row.get("train_missing_pct"),
                    "new_missing_pct": row.get("new_missing_pct"),
                }
            )
    rows.sort(key=lambda r: abs(float(r["delta_pp"])), reverse=True)
    return rows


def _top_iv_decliners(iv: Dict[str, Any], n: int = 8) -> List[Dict[str, Any]]:
    rows = [
        {
            "feature": k,
            "iv_train": round(float(v.get("iv_train", 0.0)), 4),
            "iv_new": round(float(v.get("iv_new", 0.0)), 4),
            "delta": round(float(v.get("delta", 0.0)), 4),
            "rating": v.get("rating"),
        }
        for k, v in iv.items()
        if isinstance(v, dict)
    ]
    rows.sort(key=lambda r: r["delta"])
    return rows[:n]


def _mono_summary(bivariate: Dict[str, Any]) -> Dict[str, Any]:
    broken = []
    intact = 0
    for feature, row in bivariate.items():
        if not isinstance(row, dict):
            continue
        if row.get("mono_new") is False:
            broken.append(feature)
        else:
            intact += 1
    return {"monotonicity_intact_count": intact, "monotonicity_broken_features": broken[:15]}


def build_performance_drift_payload(
    report: Dict[str, Any],
) -> Dict[str, Any]:
    perf = report.get("performance_drift") or {}
    interp = report.get("interpretability") or {}
    if not isinstance(perf, dict):
        perf = {}
    if not isinstance(interp, dict):
        interp = {}

    clf_dev = perf.get("classification_dev") or {}
    clf_new = perf.get("classification_new") or {}
    rob_dev = perf.get("rob_dev") or {}
    rob_new = perf.get("rob_new") or {}
    score_psi = perf.get("score_psi") or {}
    shap_flags = interp.get("shap_flags") or {}

    return {
        "cohort_labels": {
            "baseline": "Existing Test Data",
            "compare": "New Test Data",
        },
        "discrimination": {
            "auc_dev": perf.get("auc_dev"),
            "auc_new": perf.get("auc_new"),
            "auc_delta": round(float(perf.get("auc_new", 0)) - float(perf.get("auc_dev", 0)), 4),
            "ks_dev": perf.get("ks_dev"),
            "ks_new": perf.get("ks_new"),
            "ks_delta": round(float(perf.get("ks_new", 0)) - float(perf.get("ks_dev", 0)), 4),
            "gini_dev": perf.get("gini_dev"),
            "gini_new": perf.get("gini_new"),
            "gini_delta": round(float(perf.get("gini_new", 0)) - float(perf.get("gini_dev", 0)), 4),
            "auc_drop_pp": perf.get("auc_drop_pp"),
            "ks_drop_pp": perf.get("ks_drop_pp"),
        },
        "score_psi": {
            "psi": score_psi.get("psi") if isinstance(score_psi, dict) else score_psi,
            "band": score_psi.get("band") if isinstance(score_psi, dict) else None,
        },
        "calibration": {
            "cal_error_dev": perf.get("cal_error_dev"),
            "cal_error_new": perf.get("cal_error_new"),
            "cal_error_delta": round(
                float(perf.get("cal_error_new", 0)) - float(perf.get("cal_error_dev", 0)), 2
            ),
        },
        "rank_order": {
            "rob_dev": rob_dev,
            "rob_new": rob_new,
            "decile_rates_dev": perf.get("decile_rates_dev"),
            "decile_rates_new": perf.get("decile_rates_new"),
        },
        "classification_at_default_threshold": {
            "dev": clf_dev,
            "new": clf_new,
            "deltas": {
                "precision": round(float(clf_new.get("precision", 0)) - float(clf_dev.get("precision", 0)), 4),
                "recall": round(float(clf_new.get("recall", 0)) - float(clf_dev.get("recall", 0)), 4),
                "f1": round(float(clf_new.get("f1", 0)) - float(clf_dev.get("f1", 0)), 4),
                "accuracy": round(float(clf_new.get("accuracy", 0)) - float(clf_dev.get("accuracy", 0)), 4),
            },
        },
        "interpretability": {
            "shap_flags": shap_flags,
            "status": interp.get("status"),
        },
        "problem_type": report.get("problem_type"),
    }


def build_data_drift_payload(report: Dict[str, Any]) -> Dict[str, Any]:
    data = report.get("data_drift") or {}
    if not isinstance(data, dict):
        data = {}
    target = data.get("target_drift") or {}
    feature_csi = data.get("feature_csi") or {}
    if not isinstance(feature_csi, dict):
        feature_csi = {}
    train_rate = float(target.get("training_rate", 0.0))
    new_rate = float(target.get("new_rate", 0.0))
    rel_change_pct = (
        ((new_rate - train_rate) / train_rate * 100.0) if abs(train_rate) > 1e-9 else None
    )
    top_csi = _top_csi(feature_csi)
    max_csi = top_csi[0]["csi"] if top_csi else 0.0

    return {
        "target_drift": {
            "training_rate": train_rate,
            "new_rate": new_rate,
            "delta_pp": target.get("delta_pp"),
            "relative_change_pct": round(rel_change_pct, 2) if rel_change_pct is not None else None,
        },
        "feature_csi": {
            "max_csi": max_csi,
            "top_features": top_csi,
            "large_shift_count": sum(1 for r in top_csi if r["csi"] >= 0.25),
        },
        "cardinality_flags": _cardinality_flags(data.get("cardinality_drift") or {}),
        "missing_rate_critical": _missing_critical(data.get("missing_rate_drift") or {}),
        "segment_hotspots": _segment_hotspots(target.get("breakdown") or {}),
    }


def build_concept_drift_payload(
    report: Dict[str, Any],
    *,
    performance_summary: Optional[str] = None,
    data_drift_summary: Optional[str] = None,
) -> Dict[str, Any]:
    concept = report.get("concept_drift") or {}
    if not isinstance(concept, dict):
        concept = {}
    iv = concept.get("iv") or {}
    gini_uni = concept.get("univariate_gini") or {}
    bivariate = concept.get("bivariate_monotonicity") or {}

    gini_rows = []
    if isinstance(gini_uni, dict):
        for feature, row in gini_uni.items():
            if not isinstance(row, dict):
                continue
            gini_rows.append(
                {
                    "feature": feature,
                    "auc_dev": row.get("auc_dev") or row.get("gini_dev"),
                    "auc_new": row.get("auc_new") or row.get("gini_new"),
                    "delta": row.get("delta") or row.get("auc_delta"),
                }
            )
        gini_rows.sort(key=lambda r: float(r.get("delta") or 0))

    return {
        "prior_streams": {
            "performance_insights_excerpt": (performance_summary or "")[:500] or None,
            "data_drift_insights_excerpt": (data_drift_summary or "")[:500] or None,
        },
        "iv": {
            "top_decliners": _top_iv_decliners(iv if isinstance(iv, dict) else {}),
            "significant_decline_count": sum(
                1
                for v in (iv.values() if isinstance(iv, dict) else [])
                if isinstance(v, dict) and v.get("rating") == "significant_decline"
            ),
        },
        "univariate_gini": {"top_auc_decliners": gini_rows[:8]},
        "bivariate_monotonicity": _mono_summary(bivariate if isinstance(bivariate, dict) else {}),
    }


def build_recalibration_decision_payload(report: Dict[str, Any]) -> Dict[str, Any]:
    rec = report.get("recommendation") or {}
    insights = report.get("genai_insights") or {}
    stream_text = {}
    if isinstance(insights, dict):
        for key in ("performance_drift", "data_drift", "concept_drift"):
            block = insights.get(key)
            if isinstance(block, dict) and block.get("text"):
                stream_text[key] = str(block["text"])[:800]

    return {
        "signal_grid": report.get("signal_grid"),
        "rule_based_recommendation": rec,
        "stream_insights_excerpts": stream_text,
        "performance_summary": build_performance_drift_payload(report),
        "data_drift_summary": build_data_drift_payload(report),
        "concept_drift_summary": {
            "iv_top_decliners": _top_iv_decliners((report.get("concept_drift") or {}).get("iv") or {}),
            "monotonicity": _mono_summary((report.get("concept_drift") or {}).get("bivariate_monotonicity") or {}),
        },
    }


def _importance_top_rows(importance: Any, n: int = 10) -> List[Dict[str, Any]]:
    """Top-N comparison rows from evaluation importance payloads (dict with comparison list)."""
    if not isinstance(importance, dict):
        return []
    comparison = importance.get("comparison")
    if not isinstance(comparison, list):
        return []
    rows = [row for row in comparison if isinstance(row, dict)]
    return rows[:n]


def _cohort_metrics_block(cohort: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(cohort, dict):
        return {}
    return {
        "auc": cohort.get("auc"),
        "auc_pr": cohort.get("auc_pr"),
        "ks": cohort.get("ks"),
        "gini": cohort.get("gini"),
        "cal_error": cohort.get("cal_error"),
        "top_decile_lift": cohort.get("top_decile_lift"),
        "rank_order_break": cohort.get("rank_order_break"),
        "decile_rates": cohort.get("decile_rates"),
        "rows": cohort.get("rows"),
    }


def build_evaluation_payload(result: Dict[str, Any]) -> Dict[str, Any]:
    cohorts = result.get("evaluation_cohorts") or {}
    hold = cohorts.get("champion_hold") or {}
    oos_champ = cohorts.get("champion_oos") or {}
    oos_recal = cohorts.get("recalibrated_oos") or {}

    def _lift_d10(metrics: Dict[str, Any]) -> Optional[float]:
        table = metrics.get("lift_table") if isinstance(metrics, dict) else None
        if isinstance(table, list) and table:
            return float(table[0].get("lift", 0))
        return None

    return {
        "cohorts": {
            "existing_model_existing_test": _cohort_metrics_block(hold if isinstance(hold, dict) else {}),
            "existing_model_new_test": _cohort_metrics_block(oos_champ if isinstance(oos_champ, dict) else {}),
            "recalibrated_model_new_test": _cohort_metrics_block(oos_recal if isinstance(oos_recal, dict) else {}),
        },
        "headline_deltas": {
            "auc_delta_pp": result.get("auc_delta_pp"),
            "orig_auc": result.get("orig_auc"),
            "new_auc": result.get("new_auc"),
            "orig_ks": result.get("orig_ks"),
            "new_ks": result.get("new_ks"),
            "orig_gini": result.get("orig_gini"),
            "new_gini": result.get("new_gini"),
            "orig_cal_error": result.get("orig_cal_error"),
            "new_cal_error": result.get("new_cal_error"),
            "top_decile_lift_orig": result.get("top_decile_lift_orig"),
            "top_decile_lift_new": result.get("top_decile_lift_new"),
        },
        "rank_order": {
            "champion_oos": result.get("champion_oos_rank_order_break"),
            "recalibrated_oos": result.get("recalibrated_oos_rank_order_break"),
            "recalibrated_deciles": result.get("recalibrated_oos_rank_order_deciles"),
        },
        "lift": {
            "d10_existing_on_new_test": _lift_d10(oos_champ if isinstance(oos_champ, dict) else {}),
            "d10_recalibrated_on_new_test": _lift_d10(oos_recal if isinstance(oos_recal, dict) else {}),
        },
        "importance": {
            "jaccard": result.get("jaccard"),
            "xgboost_importance_top10": _importance_top_rows(result.get("xgboost_importance"), 10),
            "shap_importance_top10": _importance_top_rows(result.get("shap_importance"), 10),
            "shap_flags": (
                (result.get("shap_importance") or {}).get("shap_flags")
                if isinstance(result.get("shap_importance"), dict)
                else None
            ),
        },
        "policy_guardrails": result.get("policy_guardrails"),
        "problem_type": result.get("problem_type"),
    }
