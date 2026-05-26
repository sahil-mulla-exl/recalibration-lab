import numpy as np
import pandas as pd

from backend.app.utils.diagnostics_metrics import (
    compute_aucpr_logloss_brier,
    compute_cardinality_drift,
    compute_classification_metrics,
    compute_csi_categorical_details,
    compute_csi_with_frozen_bins,
    compute_descriptive_stats,
    compute_missing_rate_drift,
    compute_rob_monotonicity,
    compute_score_psi_frozen_deciles,
    find_optimal_thresholds,
)


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
