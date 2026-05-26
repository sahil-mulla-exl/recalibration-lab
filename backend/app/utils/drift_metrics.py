import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from scipy import stats


def _safe_log(x: float) -> float:
    return np.log(max(x, 1e-10))


def compute_psi(dev_scores: np.ndarray, new_scores: np.ndarray, n_bins: int = 10) -> float:
    """Population Stability Index on score distributions."""
    bins = np.percentile(dev_scores, np.linspace(0, 100, n_bins + 1))
    bins[0] = -np.inf
    bins[-1] = np.inf

    dev_counts = np.histogram(dev_scores, bins=bins)[0]
    new_counts = np.histogram(new_scores, bins=bins)[0]

    dev_pct = dev_counts / len(dev_scores)
    new_pct = new_counts / len(new_scores)

    dev_pct = np.where(dev_pct == 0, 1e-6, dev_pct)
    new_pct = np.where(new_pct == 0, 1e-6, new_pct)

    psi = np.sum((new_pct - dev_pct) * np.log(new_pct / dev_pct))
    return float(psi)


def compute_csi_numeric(dev_series: pd.Series, new_series: pd.Series, n_bins: int = 10) -> float:
    """Characteristic Stability Index for a numeric variable."""
    bins = np.percentile(dev_series.dropna(), np.linspace(0, 100, n_bins + 1))
    bins = np.unique(bins)
    if len(bins) < 3:
        return 0.0
    bins[0] = -np.inf
    bins[-1] = np.inf

    dev_counts = np.histogram(dev_series.dropna(), bins=bins)[0]
    new_counts = np.histogram(new_series.dropna(), bins=bins)[0]

    dev_pct = dev_counts / max(len(dev_series.dropna()), 1)
    new_pct = new_counts / max(len(new_series.dropna()), 1)

    dev_pct = np.where(dev_pct == 0, 1e-6, dev_pct)
    new_pct = np.where(new_pct == 0, 1e-6, new_pct)

    csi = np.sum((new_pct - dev_pct) * np.log(new_pct / dev_pct))
    return float(csi)


def compute_csi_categorical(dev_series: pd.Series, new_series: pd.Series) -> float:
    """CSI for categorical variable."""
    all_cats = set(dev_series.dropna().unique()) | set(new_series.dropna().unique())
    dev_vc = dev_series.value_counts(normalize=True)
    new_vc = new_series.value_counts(normalize=True)

    psi = 0.0
    for cat in all_cats:
        p_dev = dev_vc.get(cat, 1e-6)
        p_new = new_vc.get(cat, 1e-6)
        if p_dev < 1e-6:
            p_dev = 1e-6
        if p_new < 1e-6:
            p_new = 1e-6
        psi += (p_new - p_dev) * np.log(p_new / p_dev)
    return float(psi)


def compute_iv(series: pd.Series, target: pd.Series, n_bins: int = 10) -> Tuple[float, List[Dict]]:
    """Information Value and WoE bins for a numeric variable."""
    try:
        bins = pd.qcut(series, q=n_bins, duplicates='drop')
    except Exception:
        bins = pd.cut(series, bins=n_bins)

    df_temp = pd.DataFrame({"bin": bins, "target": target})
    grouped = df_temp.groupby("bin", observed=True)["target"].agg(["sum", "count"])
    grouped.columns = ["events", "total"]
    grouped["non_events"] = grouped["total"] - grouped["events"]

    total_events = grouped["events"].sum()
    total_non_events = grouped["non_events"].sum()

    woe_bins = []
    iv = 0.0
    for idx, row in grouped.iterrows():
        dist_events = max(row["events"] / max(total_events, 1), 1e-6)
        dist_non_events = max(row["non_events"] / max(total_non_events, 1), 1e-6)
        woe = np.log(dist_events / dist_non_events)
        iv_part = (dist_events - dist_non_events) * woe
        iv += iv_part
        woe_bins.append({
            "bin": str(idx),
            "events": int(row["events"]),
            "non_events": int(row["non_events"]),
            "woe": round(woe, 4),
            "iv": round(iv_part, 4),
        })

    return float(iv), woe_bins


def compute_ks_stat(y_true: np.ndarray, y_score: np.ndarray) -> float:
    """KS statistic between positive and negative score distributions."""
    pos_scores = y_score[y_true == 1]
    neg_scores = y_score[y_true == 0]
    if len(pos_scores) == 0 or len(neg_scores) == 0:
        return 0.0
    ks_stat, _ = stats.ks_2samp(pos_scores, neg_scores)
    return float(ks_stat)


def compute_auc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    from sklearn.metrics import roc_auc_score
    try:
        return float(roc_auc_score(y_true, y_score))
    except Exception:
        return 0.0


def compute_rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    from sklearn.metrics import mean_squared_error
    try:
        return float(np.sqrt(mean_squared_error(y_true, y_pred)))
    except Exception:
        return 0.0


def compute_mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    from sklearn.metrics import mean_absolute_error
    try:
        return float(mean_absolute_error(y_true, y_pred))
    except Exception:
        return 0.0


def compute_r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    from sklearn.metrics import r2_score
    try:
        return float(r2_score(y_true, y_pred))
    except Exception:
        return 0.0


def compute_gini(auc: float) -> float:
    return 2 * auc - 1


def compute_lift_by_decile(y_true: np.ndarray, y_score: np.ndarray) -> List[Dict]:
    """Compute lift table by decile."""
    df = pd.DataFrame({"y": y_true, "score": y_score})
    df = df.sort_values("score", ascending=False).reset_index(drop=True)
    df["decile"] = pd.qcut(df.index, q=10, labels=False)

    total_rate = df["y"].mean()
    rows = []
    for d in range(10):
        subset = df[df["decile"] == d]
        decile_rate = subset["y"].mean()
        lift = decile_rate / max(total_rate, 1e-6)
        rows.append({
            "decile": d + 1,
            "n": int(len(subset)),
            "events": int(subset["y"].sum()),
            "rate": round(float(decile_rate), 4),
            "lift": round(float(lift), 3),
            "cumulative_capture": 0.0,
        })

    # cumulative capture
    total_events = df["y"].sum()
    cum_events = 0
    for row in rows:
        cum_events += row["events"]
        row["cumulative_capture"] = round(cum_events / max(total_events, 1), 4)

    return rows


def compute_calibration_by_decile(y_true: np.ndarray, y_score: np.ndarray) -> List[Dict]:
    """Observed vs expected rate by decile."""
    df = pd.DataFrame({"y": y_true, "score": y_score})
    df["decile"] = pd.qcut(df["score"].rank(method="first"), q=10, labels=False)

    rows = []
    for d in range(10):
        subset = df[df["decile"] == d]
        observed = float(subset["y"].mean())
        expected = float(subset["score"].mean())
        dev_pct = abs(observed - expected) / max(expected, 1e-6) * 100
        rows.append({
            "decile": d + 1,
            "observed": round(observed, 4),
            "expected": round(expected, 4),
            "dev_pct": round(dev_pct, 2),
        })
    return rows


def check_monotonicity(woe_bins: List[Dict]) -> bool:
    """Check if WoE values are monotonically increasing or decreasing."""
    woes = [b["woe"] for b in woe_bins]
    if len(woes) < 2:
        return True
    diffs = [woes[i + 1] - woes[i] for i in range(len(woes) - 1)]
    return all(d >= 0 for d in diffs) or all(d <= 0 for d in diffs)
