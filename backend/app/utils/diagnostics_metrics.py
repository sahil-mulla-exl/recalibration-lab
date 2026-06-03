from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Sequence, Tuple

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    f1_score,
    log_loss,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)

logger = logging.getLogger(__name__)


def _to_numeric_array(series: pd.Series) -> np.ndarray:
    return pd.to_numeric(series, errors="coerce").to_numpy(dtype=float)


def _safe_pct(counts: np.ndarray) -> np.ndarray:
    denom = max(float(np.sum(counts)), 1.0)
    pct = counts / denom
    return np.where(pct <= 0, 1e-6, pct)


def compute_csi_with_frozen_bins(
    train_series: pd.Series,
    new_series: pd.Series,
    n_bins: int = 10,
) -> Dict[str, Any]:
    train_vals = _to_numeric_array(train_series)
    new_vals = _to_numeric_array(new_series)
    train_vals = train_vals[np.isfinite(train_vals)]
    new_vals = new_vals[np.isfinite(new_vals)]
    if train_vals.size == 0 or new_vals.size == 0:
        return {"csi": 0.0, "bins": [], "train_pct": [], "new_pct": [], "contrib": []}

    raw_bins = np.percentile(train_vals, np.linspace(0, 100, n_bins + 1))
    bins = np.unique(raw_bins)
    if bins.size < 3:
        return {"csi": 0.0, "bins": [], "train_pct": [], "new_pct": [], "contrib": []}
    bins[0] = -np.inf
    bins[-1] = np.inf
    train_counts = np.histogram(train_vals, bins=bins)[0]
    new_counts = np.histogram(new_vals, bins=bins)[0]
    train_pct = _safe_pct(train_counts)
    new_pct = _safe_pct(new_counts)
    contrib = (new_pct - train_pct) * np.log(new_pct / train_pct)
    csi = float(np.sum(contrib))
    return {
        "csi": csi,
        "bins": bins.tolist(),
        "train_pct": train_pct.tolist(),
        "new_pct": new_pct.tolist(),
        "contrib": contrib.tolist(),
    }


def compute_csi_categorical_details(train_series: pd.Series, new_series: pd.Series) -> Dict[str, Any]:
    train = train_series.fillna("__NULL__").astype(str)
    new = new_series.fillna("__NULL__").astype(str)
    cats = sorted(set(train.unique().tolist()) | set(new.unique().tolist()))
    train_vc = train.value_counts(normalize=True)
    new_vc = new.value_counts(normalize=True)
    train_pct = np.array([float(train_vc.get(c, 1e-6)) for c in cats], dtype=float)
    new_pct = np.array([float(new_vc.get(c, 1e-6)) for c in cats], dtype=float)
    train_pct = np.where(train_pct <= 0, 1e-6, train_pct)
    new_pct = np.where(new_pct <= 0, 1e-6, new_pct)
    contrib = (new_pct - train_pct) * np.log(new_pct / train_pct)
    return {
        "csi": float(np.sum(contrib)),
        "categories": cats,
        "train_pct": train_pct.tolist(),
        "new_pct": new_pct.tolist(),
        "contrib": contrib.tolist(),
    }


def compute_woe_iv_with_frozen_bins(
    train_series: pd.Series,
    train_target: pd.Series,
    new_series: pd.Series,
    new_target: pd.Series,
    n_bins: int = 10,
) -> Dict[str, Any]:
    x_train = pd.to_numeric(train_series, errors="coerce")
    x_new = pd.to_numeric(new_series, errors="coerce")
    y_train = pd.to_numeric(train_target, errors="coerce").fillna(0).astype(int)
    y_new = pd.to_numeric(new_target, errors="coerce").fillna(0).astype(int)

    valid_train = x_train.notna() & y_train.notna()
    valid_new = x_new.notna() & y_new.notna()
    x_train = x_train[valid_train]
    y_train = y_train[valid_train]
    x_new = x_new[valid_new]
    y_new = y_new[valid_new]
    if x_train.empty or x_new.empty:
        return {
            "iv_train": 0.0,
            "iv_new": 0.0,
            "delta": 0.0,
            "bins": [],
            "woe_train": [],
            "woe_new": [],
            "mono_train": True,
            "mono_new": True,
        }

    raw_bins = np.percentile(x_train, np.linspace(0, 100, n_bins + 1))
    bins = np.unique(raw_bins)
    if bins.size < 3:
        bins = np.array([-np.inf, np.inf], dtype=float)
    else:
        bins[0] = -np.inf
        bins[-1] = np.inf

    def _compute_woe_iv(x: pd.Series, y: pd.Series) -> Tuple[float, List[float]]:
        frame = pd.DataFrame({"x": x, "y": y})
        frame["bin"] = pd.cut(frame["x"], bins=bins, include_lowest=True)
        grouped = frame.groupby("bin", observed=True)["y"].agg(["sum", "count"])
        grouped.columns = ["events", "total"]
        grouped["non_events"] = grouped["total"] - grouped["events"]
        total_events = max(float(grouped["events"].sum()), 1.0)
        total_non_events = max(float(grouped["non_events"].sum()), 1.0)
        woes: List[float] = []
        iv = 0.0
        for _, row in grouped.iterrows():
            dist_e = max(float(row["events"]) / total_events, 1e-6)
            dist_n = max(float(row["non_events"]) / total_non_events, 1e-6)
            woe = float(np.log(dist_e / dist_n))
            iv += (dist_e - dist_n) * woe
            woes.append(woe)
        return float(iv), woes

    iv_train, woe_train = _compute_woe_iv(x_train, y_train)
    iv_new, woe_new = _compute_woe_iv(x_new, y_new)
    delta = float(iv_new - iv_train)
    return {
        "iv_train": iv_train,
        "iv_new": iv_new,
        "delta": delta,
        "bins": bins.tolist(),
        "woe_train": woe_train,
        "woe_new": woe_new,
        "mono_train": is_monotone(woe_train),
        "mono_new": is_monotone(woe_new),
    }


def is_monotone(values: Sequence[float]) -> bool:
    if len(values) < 2:
        return True
    diff = np.diff(np.asarray(values, dtype=float))
    return bool(np.all(diff >= 0) or np.all(diff <= 0))


def _coerce_binary_target_array(target: pd.Series) -> np.ndarray:
    numeric = pd.to_numeric(target, errors="coerce")
    if numeric.notna().mean() >= 0.7:
        return numeric.fillna(0.0).clip(lower=0.0, upper=1.0).round().astype(int).to_numpy()

    text = target.astype(str).str.strip().str.lower()
    positive_tokens = {"1", "true", "yes", "y", "event", "bad", "default", "positive"}
    negative_tokens = {"0", "false", "no", "n", "non-event", "nonevent", "good", "negative"}
    mapped = pd.Series(np.nan, index=target.index, dtype=float)
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
    return mapped.fillna(0.0).astype(int).to_numpy()


def _variable_scores(series: pd.Series, categorical_encode: bool) -> np.ndarray:
    if pd.api.types.is_bool_dtype(series):
        return series.astype(float).to_numpy()
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce").to_numpy(dtype=float)
    if categorical_encode:
        codes, _ = pd.factorize(series.astype(str), sort=True)
        return codes.astype(float)
    as_num = pd.to_numeric(series, errors="coerce")
    if as_num.notna().mean() >= 0.9:
        return as_num.to_numpy(dtype=float)
    codes, _ = pd.factorize(series.astype(str), sort=True)
    return codes.astype(float)


def compute_univariate_gini(
    df: pd.DataFrame,
    variable: str,
    target: str,
    min_events: int = 50,
    categorical_encode: bool = False,
    abs_gini: bool = False,
) -> Dict[str, Any]:
    """Compute univariate Gini (= 2×AUC − 1) for one variable in one dataset.

    The variable's raw values are used directly as ranking scores (no model fit).
    """
    empty: Dict[str, Any] = {
        "gini": None,
        "auc": None,
        "n": 0,
        "n_events": 0,
        "insufficient_events": True,
    }
    if variable not in df.columns or target not in df.columns:
        logger.debug("Univariate Gini skipped: missing column %s or %s", variable, target)
        return empty

    frame = df[[variable, target]].dropna(subset=[variable, target])
    if frame.empty:
        return empty

    y = _coerce_binary_target_array(frame[target])
    scores = _variable_scores(frame[variable], categorical_encode)
    valid = np.isfinite(scores)
    if not valid.all():
        y = y[valid]
        scores = scores[valid]
    if y.size == 0:
        return empty

    n_events = int(np.sum(y == 1))
    n_non_events = int(np.sum(y == 0))
    if n_events < min_events or n_non_events < min_events:
        return {
            "gini": None,
            "auc": None,
            "n": int(y.size),
            "n_events": n_events,
            "insufficient_events": True,
        }

    if len(np.unique(y)) < 2:
        auc = 0.5
    else:
        try:
            auc = float(roc_auc_score(y, scores))
        except ValueError as exc:
            logger.debug("Univariate Gini AUC failed for %s: %s", variable, exc)
            auc = 0.5

    gini = 2.0 * auc - 1.0
    if abs_gini:
        gini = abs(gini)

    return {
        "gini": float(gini),
        "auc": float(auc),
        "n": int(y.size),
        "n_events": n_events,
        "insufficient_events": False,
    }


def compute_univariate_gini_comparison(
    dev_df: pd.DataFrame,
    new_df: pd.DataFrame,
    variables: Sequence[str],
    dev_target: str,
    new_target: str,
    min_events: int = 50,
    categorical_encode: bool = False,
    abs_gini: bool = False,
) -> Dict[str, Dict[str, Any]]:
    """Univariate Gini per model feature on dev validation and new data."""
    results: Dict[str, Dict[str, Any]] = {}
    kwargs = {
        "min_events": min_events,
        "categorical_encode": categorical_encode,
        "abs_gini": abs_gini,
    }
    for variable in variables:
        if variable not in dev_df.columns or variable not in new_df.columns:
            continue
        dev_res = compute_univariate_gini(dev_df, variable, dev_target, **kwargs)
        new_res = compute_univariate_gini(new_df, variable, new_target, **kwargs)
        dev_gini = dev_res.get("gini")
        new_gini = new_res.get("gini")
        delta: float | None = None
        if dev_gini is not None and new_gini is not None:
            delta = float(new_gini) - float(dev_gini)
        results[variable] = {
            "dev_gini": dev_gini,
            "new_gini": new_gini,
            "dev_auc": dev_res.get("auc"),
            "new_auc": new_res.get("auc"),
            "delta": delta,
            "dev_n": dev_res.get("n"),
            "new_n": new_res.get("n"),
            "insufficient_events": bool(
                dev_res.get("insufficient_events") or new_res.get("insufficient_events")
            ),
        }
    return results


def compute_bivariate_event_rate(
    train_series: pd.Series,
    train_target: pd.Series,
    new_series: pd.Series,
    new_target: pd.Series,
    n_bins: int = 10,
) -> Dict[str, Any]:
    x_train = pd.to_numeric(train_series, errors="coerce")
    x_new = pd.to_numeric(new_series, errors="coerce")
    y_train = pd.to_numeric(train_target, errors="coerce").fillna(0).astype(int)
    y_new = pd.to_numeric(new_target, errors="coerce").fillna(0).astype(int)
    valid_train = x_train.notna()
    valid_new = x_new.notna()
    x_train = x_train[valid_train]
    y_train = y_train[valid_train]
    x_new = x_new[valid_new]
    y_new = y_new[valid_new]
    if x_train.empty:
        return {"bin_labels": [], "train_rate": [], "new_rate": [], "mono_train": True, "mono_new": True}

    raw_bins = np.percentile(x_train, np.linspace(0, 100, n_bins + 1))
    bins = np.unique(raw_bins)
    if bins.size < 3:
        bins = np.array([-np.inf, np.inf], dtype=float)
    else:
        bins[0] = -np.inf
        bins[-1] = np.inf

    def _rates_and_population(x: pd.Series, y: pd.Series) -> tuple[List[float], List[float]]:
        frame = pd.DataFrame({"x": x, "y": y})
        frame["bin"] = pd.cut(frame["x"], bins=bins, include_lowest=True)
        grouped = frame.groupby("bin", observed=True)
        rates = grouped["y"].mean().fillna(0.0).tolist()
        counts = grouped.size().tolist()
        total = max(float(len(frame)), 1.0)
        population_pct = [float(c) / total * 100.0 for c in counts]
        return [float(r) for r in rates], population_pct

    train_rate, train_pop = _rates_and_population(x_train, y_train)
    new_rate, new_pop = _rates_and_population(x_new, y_new)
    labels = [f"B{i + 1}" for i in range(max(len(train_rate), len(new_rate)))]
    return {
        "bin_labels": labels,
        "train_rate": train_rate,
        "new_rate": new_rate,
        "train_population_pct": train_pop,
        "new_population_pct": new_pop,
        "mono_train": is_monotone(train_rate),
        "mono_new": is_monotone(new_rate),
    }


def compute_cardinality_drift(train_series: pd.Series, new_series: pd.Series) -> Dict[str, Any]:
    train_cats = sorted(set(train_series.fillna("__NULL__").astype(str).unique().tolist()))
    new_cats = sorted(set(new_series.fillna("__NULL__").astype(str).unique().tolist()))
    new_only = sorted(set(new_cats) - set(train_cats))
    lost = sorted(set(train_cats) - set(new_cats))
    return {
        "train_categories": train_cats,
        "new_categories": new_cats,
        "new_only": new_only,
        "lost": lost,
        "new_count": len(new_only),
        "lost_count": len(lost),
    }


def compute_missing_rate_drift(train_series: pd.Series, new_series: pd.Series) -> Dict[str, Any]:
    train_pct = float(train_series.isna().mean() * 100.0)
    new_pct = float(new_series.isna().mean() * 100.0)
    return {
        "train_missing_pct": train_pct,
        "new_missing_pct": new_pct,
        "delta_pp": new_pct - train_pct,
    }


def compute_descriptive_stats(series: pd.Series) -> Dict[str, float]:
    values = pd.to_numeric(series, errors="coerce")
    finite = values.dropna()
    if finite.empty:
        return {
            "mean": 0.0,
            "std": 0.0,
            "missing_pct": float(series.isna().mean() * 100.0),
            "p1": 0.0,
            "p5": 0.0,
            "p10": 0.0,
            "p25": 0.0,
            "p50": 0.0,
            "p75": 0.0,
            "p90": 0.0,
            "p95": 0.0,
            "p99": 0.0,
        }
    q = finite.quantile([0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99])
    return {
        "mean": float(finite.mean()),
        "std": float(finite.std(ddof=0)),
        "missing_pct": float(series.isna().mean() * 100.0),
        "p1": float(q.loc[0.01]),
        "p5": float(q.loc[0.05]),
        "p10": float(q.loc[0.10]),
        "p25": float(q.loc[0.25]),
        "p50": float(q.loc[0.50]),
        "p75": float(q.loc[0.75]),
        "p90": float(q.loc[0.90]),
        "p95": float(q.loc[0.95]),
        "p99": float(q.loc[0.99]),
    }


def compute_score_psi_frozen_deciles(dev_scores: np.ndarray, new_scores: np.ndarray) -> Dict[str, Any]:
    dev_scores = np.asarray(dev_scores, dtype=float)
    new_scores = np.asarray(new_scores, dtype=float)
    bins = np.percentile(dev_scores, np.linspace(0, 100, 11))
    bins[0] = -np.inf
    bins[-1] = np.inf
    dev_counts = np.histogram(dev_scores, bins=bins)[0]
    new_counts = np.histogram(new_scores, bins=bins)[0]
    dev_pct = _safe_pct(dev_counts)
    new_pct = _safe_pct(new_counts)
    contrib = (new_pct - dev_pct) * np.log(new_pct / dev_pct)
    return {
        "psi": float(np.sum(contrib)),
        "decile_edges": bins.tolist(),
        "dev_pct": dev_pct.tolist(),
        "new_pct": new_pct.tolist(),
        "contrib": contrib.tolist(),
    }


def compute_decile_event_rates(y_true: np.ndarray, y_score: np.ndarray) -> List[float]:
    df = pd.DataFrame({"y": y_true, "score": y_score})
    if df.empty:
        return []
    df = df.sort_values("score", ascending=True).reset_index(drop=True)
    df["decile"] = pd.qcut(df.index, q=10, labels=False, duplicates="drop")
    rates = df.groupby("decile", observed=True)["y"].mean().tolist()
    return [float(r * 100.0) for r in rates]


def compute_rob_monotonicity(decile_rates: Sequence[float]) -> Dict[str, Any]:
    rates = list(decile_rates)
    if len(rates) < 2:
        return {
            "non_decreasing_count": 0,
            "total_transitions": 0,
            "break_indices": [],
            "monotonicity_violations": [],
        }
    break_indices: List[int] = []
    violations: List[Dict[str, int]] = []
    count = 0
    for idx in range(len(rates) - 1):
        if rates[idx + 1] >= rates[idx]:
            count += 1
        else:
            break_indices.append(idx + 2)
            violations.append({"from_decile": idx + 1, "to_decile": idx + 2})
    return {
        "non_decreasing_count": count,
        "total_transitions": len(rates) - 1,
        "break_indices": break_indices,
        "monotonicity_violations": violations,
    }


def compute_decile_rank_order_rows(y_true: np.ndarray, y_score: np.ndarray) -> List[Dict[str, Any]]:
    """Decile table for rank-order analysis (decile 1 = lowest score / lowest risk)."""
    df = pd.DataFrame({"y": np.asarray(y_true, dtype=float), "score": np.asarray(y_score, dtype=float)})
    if df.empty:
        return []
    df = df.sort_values("score", ascending=True).reset_index(drop=True)
    df["decile"] = pd.qcut(df.index, q=10, labels=False, duplicates="drop")
    total_rate = float(df["y"].mean())
    total_events = int(df["y"].sum())
    rows: List[Dict[str, Any]] = []
    cum_events = 0
    for d in sorted(df["decile"].dropna().unique()):
        subset = df[df["decile"] == d]
        count = int(len(subset))
        events = int(subset["y"].sum())
        non_events = max(0, count - events)
        rate = float(subset["y"].mean()) if count else 0.0
        avg_score = float(subset["score"].mean()) if count else 0.0
        lift = rate / max(total_rate, 1e-6)
        cum_events += events
        cum_rate = cum_events / max(total_events, 1)
        rows.append(
            {
                "decile": int(d) + 1,
                "count": count,
                "events": events,
                "non_events": non_events,
                "event_rate": round(rate, 6),
                "avg_score": round(avg_score, 6),
                "lift": round(float(lift), 4),
                "cum_event_rate": round(float(cum_rate), 4),
            }
        )
    return rows


def compute_rank_order_analysis(y_true: np.ndarray, y_score: np.ndarray) -> Dict[str, Any]:
    """Full rank-order payload: decile rows, event rates (%), and monotonicity summary."""
    deciles = compute_decile_rank_order_rows(y_true, y_score)
    decile_rates = compute_decile_event_rates(y_true, y_score)
    rank_order_break = compute_rob_monotonicity(decile_rates)
    return {
        "deciles": deciles,
        "decile_rates": decile_rates,
        "rank_order_break": rank_order_break,
    }


def compute_classification_metrics(
    y_true: np.ndarray,
    y_score: np.ndarray,
    threshold: float,
) -> Dict[str, Any]:
    y_true = np.asarray(y_true, dtype=int)
    y_score = np.asarray(y_score, dtype=float)
    y_pred = (y_score >= float(threshold)).astype(int)
    tp = int(np.sum((y_true == 1) & (y_pred == 1)))
    fp = int(np.sum((y_true == 0) & (y_pred == 1)))
    tn = int(np.sum((y_true == 0) & (y_pred == 0)))
    fn = int(np.sum((y_true == 1) & (y_pred == 0)))
    return {
        "threshold": float(threshold),
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "accuracy": float(accuracy_score(y_true, y_pred)),
    }


def find_optimal_thresholds(y_true: np.ndarray, y_score: np.ndarray) -> Dict[str, float]:
    y_true = np.asarray(y_true, dtype=int)
    y_score = np.asarray(y_score, dtype=float)
    if len(np.unique(y_true)) < 2:
        return {"ks_optimal": 0.5, "f1_optimal": 0.5}
    fpr, tpr, thresholds = roc_curve(y_true, y_score)
    ks_values = tpr - fpr
    ks_idx = int(np.argmax(ks_values))
    ks_opt = float(thresholds[ks_idx])
    candidate = np.linspace(0.01, 0.99, 99)
    f1_values = [f1_score(y_true, (y_score >= t).astype(int), zero_division=0) for t in candidate]
    f1_opt = float(candidate[int(np.argmax(f1_values))])
    return {"ks_optimal": ks_opt, "f1_optimal": f1_opt}


def compute_aucpr_logloss_brier(y_true: np.ndarray, y_score: np.ndarray) -> Dict[str, float]:
    y_true = np.asarray(y_true, dtype=int)
    y_score = np.asarray(y_score, dtype=float)
    y_score = np.clip(y_score, 1e-6, 1 - 1e-6)
    try:
        auc_pr = float(average_precision_score(y_true, y_score))
    except Exception:
        auc_pr = 0.0
    try:
        ll = float(log_loss(y_true, y_score))
    except Exception:
        ll = 0.0
    try:
        brier = float(brier_score_loss(y_true, y_score))
    except Exception:
        brier = 0.0
    return {"auc_pr": auc_pr, "log_loss": ll, "brier": brier}


def _downsample_indices(length: int, target: int) -> np.ndarray:
    if length <= target:
        return np.arange(length, dtype=int)
    return np.linspace(0, length - 1, target, dtype=int)


def compute_roc_curve_points(y_true: np.ndarray, y_score: np.ndarray, n: int = 60) -> List[Dict[str, float]]:
    y_true = np.asarray(y_true, dtype=int)
    y_score = np.asarray(y_score, dtype=float)
    if len(np.unique(y_true)) < 2:
        return []
    fpr, tpr, thresholds = roc_curve(y_true, y_score)
    idx = _downsample_indices(len(fpr), n)
    return [{"fpr": float(fpr[i]), "tpr": float(tpr[i]), "threshold": float(thresholds[i])} for i in idx]


def compute_ks_curve_points(y_true: np.ndarray, y_score: np.ndarray, n: int = 60) -> List[Dict[str, float]]:
    y_true = np.asarray(y_true, dtype=int)
    y_score = np.asarray(y_score, dtype=float)
    if y_true.size == 0:
        return []
    frame = pd.DataFrame({"y": y_true, "score": y_score}).sort_values("score", ascending=False)
    total_pos = max(float((frame["y"] == 1).sum()), 1.0)
    total_neg = max(float((frame["y"] == 0).sum()), 1.0)
    frame["cum_pos"] = (frame["y"] == 1).cumsum() / total_pos
    frame["cum_neg"] = (frame["y"] == 0).cumsum() / total_neg
    n_rows = len(frame)
    frame["population_pct"] = np.arange(n_rows) / max(n_rows - 1, 1)
    frame["ks"] = np.abs(frame["cum_pos"] - frame["cum_neg"])
    idx = _downsample_indices(len(frame), max(n - 1, 1))
    points = [{"population_pct": 0.0, "cum_pos_pct": 0.0, "cum_neg_pct": 0.0, "ks": 0.0}]
    for i in idx:
        row = frame.iloc[int(i)]
        points.append(
            {
                "population_pct": float(row["population_pct"] * 100.0),
                "cum_pos_pct": float(row["cum_pos"] * 100.0),
                "cum_neg_pct": float(row["cum_neg"] * 100.0),
                "ks": float(row["ks"]),
            }
        )
    return points

