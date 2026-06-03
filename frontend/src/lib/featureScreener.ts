/** Metric filters for recalibration feature selection (MIDAS-style screener). */

export type ScreenerMetric = "iv" | "univariate_auc" | "csi";

export type ScreenerOperator = "gte" | "lte" | "gt" | "lt" | "eq";

export type ScreenerFilterLogic = "and" | "or";

export type ScreenerFilter = {
  metric: ScreenerMetric;
  operator: ScreenerOperator;
  value: number;
};

export type FeatureScreenerMetrics = {
  iv: number | null;
  univariate_auc: number | null;
  csi: number | null;
};

const OPERATOR_LABELS: Record<ScreenerOperator, string> = {
  gte: "≥",
  lte: "≤",
  gt: ">",
  lt: "<",
  eq: "=",
};

export function screenerOperatorLabel(op: ScreenerOperator): string {
  return OPERATOR_LABELS[op] ?? op;
}

export function screenerMetricLabel(metric: ScreenerMetric): string {
  if (metric === "iv") return "Univariate IV";
  if (metric === "univariate_auc") return "Univariate AUC";
  return "CSI";
}

export function getScreenerMetricValue(
  metrics: FeatureScreenerMetrics | undefined,
  metric: ScreenerMetric,
): number | null {
  if (!metrics) return null;
  const raw = metrics[metric];
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return null;
  return Number(raw);
}

export function doesScreenerFilterPass(
  metrics: FeatureScreenerMetrics | undefined,
  filter: ScreenerFilter,
): boolean {
  const metricValue = getScreenerMetricValue(metrics, filter.metric);
  if (metricValue === null) return false;
  const threshold = Number(filter.value);
  if (!Number.isFinite(threshold)) return false;

  const displayMetric = Number(metricValue.toFixed(4));
  const displayThreshold = Number(threshold.toFixed(4));

  switch (filter.operator) {
    case "gte":
      return displayMetric >= displayThreshold;
    case "lte":
      return displayMetric <= displayThreshold;
    case "gt":
      return displayMetric > displayThreshold;
    case "lt":
      return displayMetric < displayThreshold;
    case "eq":
      return displayMetric === displayThreshold;
    default:
      return true;
  }
}

export function featurePassesFilters(
  metrics: FeatureScreenerMetrics | undefined,
  filters: ScreenerFilter[],
  logic: ScreenerFilterLogic = "and",
): boolean {
  if (!filters.length) return true;
  if (logic === "or") {
    return filters.some((f) => doesScreenerFilterPass(metrics, f));
  }
  return filters.every((f) => doesScreenerFilterPass(metrics, f));
}

/** Build per-feature metrics from diagnostics report (legacy + v3 shape). */
export function buildFeatureMetricsFromDrift(
  driftResult: Record<string, unknown> | null | undefined,
  features: string[],
): Record<string, FeatureScreenerMetrics> {
  const out: Record<string, FeatureScreenerMetrics> = {};
  if (!driftResult) return out;

  const csiMap = (driftResult.csi_results ?? {}) as Record<string, number>;
  const ivMap = (driftResult.iv_results ?? {}) as Record<
    string,
    { iv_dev?: number; iv_new?: number; iv_train?: number }
  >;
  const concept = (driftResult.concept_drift ?? {}) as {
    univariate_gini?: Record<
      string,
      { dev_gini?: number; dev_auc?: number; new_auc?: number }
    >;
    iv?: Record<string, { iv_train?: number; iv_new?: number }>;
  };
  const uniGini = concept.univariate_gini ?? {};
  const conceptIv = concept.iv ?? {};

  for (const feature of features) {
    const legacyIv = ivMap[feature];
    const conceptIvRow = conceptIv[feature];
    const ivNew = legacyIv?.iv_new ?? conceptIvRow?.iv_new;
    const ivDev = legacyIv?.iv_dev ?? conceptIvRow?.iv_train;
    const iv =
      ivNew != null && Number.isFinite(Number(ivNew))
        ? Number(ivNew)
        : ivDev != null && Number.isFinite(Number(ivDev))
          ? Number(ivDev)
          : null;

    const uni = uniGini[feature];
    let univariateAuc: number | null = null;
    if (uni?.dev_auc != null && Number.isFinite(Number(uni.dev_auc))) {
      univariateAuc = Number(uni.dev_auc);
    } else if (uni?.dev_gini != null && Number.isFinite(Number(uni.dev_gini))) {
      univariateAuc = (Number(uni.dev_gini) + 1) / 2;
    }

    const csiRaw = csiMap[feature];
    const csi =
      csiRaw != null && Number.isFinite(Number(csiRaw)) ? Number(csiRaw) : null;

    out[feature] = { iv, univariate_auc: univariateAuc, csi };
  }

  return out;
}
