import numpy as np
import pandas as pd
import pytest

from backend.app.utils.diagnostics_metrics import (
    compute_aucpr_logloss_brier,
    compute_cardinality_drift,
    compute_classification_metrics,
    compute_csi_categorical_details,
    compute_csi_with_frozen_bins,
    compute_descriptive_stats,
    compute_missing_rate_drift,
    compute_rank_order_analysis,
    compute_rob_monotonicity,
    compute_score_psi_frozen_deciles,
    compute_univariate_gini,
    compute_univariate_gini_comparison,
    find_optimal_thresholds,
)
from sklearn.metrics import roc_auc_score


def test_compute_csi_with_frozen_bins_returns_expected_shape() -> None:
    train = pd.Series(np.linspace(0, 1, 100))
    new = pd.Series(np.linspace(0.1, 1.1, 100))
    out = compute_csi_with_frozen_bins(train, new, n_bins=10)
    assert "csi" in out
    assert len(out["train_pct"]) == len(out["new_pct"]) == len(out["contrib"])
    assert out["csi"] >= 0


def test_compute_csi_categorical_details_handles_new_categories() -> None:
    train = pd.Series(["A", "A", "B", "B"])
    new = pd.Series(["A", "C", "C", "C"])
    out = compute_csi_categorical_details(train, new)
    assert "csi" in out
    assert "categories" in out
    assert "C" in out["categories"]


def test_cardinality_and_missing_drift() -> None:
    train = pd.Series(["x", "y", None, "x"])
    new = pd.Series(["x", "z", None, None])
    cardinality = compute_cardinality_drift(train, new)
    missing = compute_missing_rate_drift(train, new)
    assert "z" in cardinality["new_only"]
    assert "z" in cardinality["new_category_names"]
    assert "y" in cardinality["lost_category_names"]
    assert missing["delta_pp"] > 0


def test_descriptive_stats_percentiles_present() -> None:
    s = pd.Series([1, 2, 3, 4, 5, None])
    out = compute_descriptive_stats(s)
    for key in ("p1", "p5", "p10", "p25", "p50", "p75", "p90", "p95", "p99"):
        assert key in out


def test_score_psi_and_rob_monotonicity() -> None:
    dev = np.linspace(0, 1, 1000)
    new = np.linspace(0.2, 1.2, 1000)
    psi = compute_score_psi_frozen_deciles(dev, new)
    rob = compute_rob_monotonicity([1, 2, 3, 2, 5])
    assert psi["psi"] >= 0
    assert rob["non_decreasing_count"] == 3
    assert rob["total_transitions"] == 4
    assert len(rob["monotonicity_violations"]) == 1


def test_rank_order_analysis_returns_decile_table() -> None:
    rng = np.random.default_rng(42)
    y = (rng.random(500) > 0.7).astype(int)
    scores = rng.random(500)
    out = compute_rank_order_analysis(y, scores)
    assert len(out["deciles"]) >= 2
    assert out["deciles"][0]["decile"] == 1
    assert "event_rate" in out["deciles"][0]
    assert "rank_order_break" in out


def test_compute_univariate_gini_uses_raw_scores() -> None:
    rng = np.random.default_rng(7)
    n = 200
    x = rng.normal(size=n)
    prob = 1 / (1 + np.exp(-(x - x.mean()) / x.std()))
    y = (rng.random(n) < prob).astype(int)
    df = pd.DataFrame({"feat": x, "target": y})
    out = compute_univariate_gini(df, "feat", "target", min_events=10)
    assert out["insufficient_events"] is False
    assert out["gini"] is not None
    expected_auc = float(roc_auc_score(y, x))
    assert out["auc"] == pytest.approx(expected_auc, rel=1e-6)
    assert out["gini"] == pytest.approx(2 * expected_auc - 1, rel=1e-6)


def test_compute_univariate_gini_drops_nan_and_respects_min_events() -> None:
    df = pd.DataFrame({"feat": [1.0, 2.0, None, 4.0], "target": [0, 1, 0, 1]})
    out = compute_univariate_gini(df, "feat", "target", min_events=50)
    assert out["insufficient_events"] is True
    assert out["gini"] is None


def test_compute_univariate_gini_comparison_returns_delta() -> None:
    dev = pd.DataFrame({"feat": np.linspace(0, 1, 120), "target": [0, 1] * 60})
    new = pd.DataFrame({"feat": np.linspace(0, 1, 120), "target": [0, 1] * 60})
    out = compute_univariate_gini_comparison(
        dev, new, ["feat"], "target", "target", min_events=10
    )
    row = out["feat"]
    assert row["dev_gini"] is not None
    assert row["new_gini"] is not None
    assert row["delta"] == pytest.approx(float(row["new_gini"]) - float(row["dev_gini"]))


def test_classification_metrics_and_thresholds() -> None:
    y_true = np.array([0, 0, 1, 1, 1, 0, 1, 0])
    y_score = np.array([0.1, 0.2, 0.8, 0.7, 0.9, 0.4, 0.6, 0.3])
    metrics = compute_classification_metrics(y_true, y_score, threshold=0.5)
    optimal = find_optimal_thresholds(y_true, y_score)
    pr_metrics = compute_aucpr_logloss_brier(y_true, y_score)
    assert metrics["tp"] >= 1
    assert 0 <= optimal["ks_optimal"] <= 1.1
    assert 0 <= optimal["f1_optimal"] <= 1
    assert pr_metrics["auc_pr"] > 0
