/** Inventory configuration options (must match ModelInventory CONFIG_GROUPS). */
export const INVENTORY_DATA_DRIFT = ["PSI", "CSI", "IV", "WOE"] as const;
export const INVENTORY_CONCEPT_DRIFT = ["Target Shift"] as const;
export const INVENTORY_PERFORMANCE_CLASSIFICATION = [
  "AUC",
  "KS",
  "GINI",
  "Calibration",
  "Lift/Gains",
  "Feature Importance",
] as const;
export const INVENTORY_PERFORMANCE_REGRESSION = ["RMSE", "MAE", "R2"] as const;

export const INVENTORY_PERFORMANCE_METRICS = [
  ...INVENTORY_PERFORMANCE_CLASSIFICATION,
  ...INVENTORY_PERFORMANCE_REGRESSION,
] as const;

export type InventoryPerformanceMetric = (typeof INVENTORY_PERFORMANCE_METRICS)[number];
export type InventoryConfigOption =
  | (typeof INVENTORY_DATA_DRIFT)[number]
  | (typeof INVENTORY_CONCEPT_DRIFT)[number]
  | InventoryPerformanceMetric;

export type ProblemType = "classification" | "regression";

export function normalizeProblemType(raw: unknown): ProblemType {
  return String(raw ?? "classification").toLowerCase().startsWith("reg")
    ? "regression"
    : "classification";
}

export function isPerformanceMetric(option: string): option is InventoryPerformanceMetric {
  return (INVENTORY_PERFORMANCE_METRICS as readonly string[]).includes(option);
}

/** Performance metrics from inventory that apply to the current problem type. */
export function performanceMetricsForProblem(
  selected: string[] | undefined,
  problemType: ProblemType,
): InventoryPerformanceMetric[] {
  const allowed =
    problemType === "regression"
      ? INVENTORY_PERFORMANCE_REGRESSION
      : INVENTORY_PERFORMANCE_CLASSIFICATION;
  const allowedSet = new Set<string>(allowed);
  return (selected ?? []).filter(
    (m): m is InventoryPerformanceMetric => allowedSet.has(m),
  );
}

export type EvaluationMetricVisibility = {
  showAuc: boolean;
  showKs: boolean;
  showGini: boolean;
  showCalibration: boolean;
  showLift: boolean;
  /** Rank-order break decile analysis (classification; not tied to Lift/Gains alone). */
  showRankOrderBreak: boolean;
  showFeatureImportance: boolean;
  showRmse: boolean;
  showMae: boolean;
  showR2: boolean;
  hasAny: boolean;
};

export function evaluationMetricVisibility(
  selected: string[] | undefined,
  problemType: ProblemType,
): EvaluationMetricVisibility {
  const perf = new Set(performanceMetricsForProblem(selected, problemType));
  const flags = {
    showAuc: perf.has("AUC"),
    showKs: perf.has("KS"),
    showGini: perf.has("GINI"),
    showCalibration: perf.has("Calibration"),
    showLift: perf.has("Lift/Gains"),
    showFeatureImportance: perf.has("Feature Importance"),
    showRmse: perf.has("RMSE"),
    showMae: perf.has("MAE"),
    showR2: perf.has("R2"),
  };
  const hasAny = Object.values(flags).some(Boolean);
  const showRankOrderBreak =
    problemType === "classification" &&
    (flags.showLift ||
      flags.showAuc ||
      flags.showKs ||
      flags.showGini ||
      flags.showCalibration);
  return {
    ...flags,
    showRankOrderBreak,
    hasAny,
  };
}

export type PerfDriftVisibility = EvaluationMetricVisibility & {
  showClassificationBlock: boolean;
  showDiscriminationBlock: boolean;
  showRankOrderBlock: boolean;
  showInterpretabilityBlock: boolean;
  showScorePsi: boolean;
  showRoc: boolean;
  showKsCurve: boolean;
  showCalibrationChart: boolean;
  showDecileLift: boolean;
  showShap: boolean;
};

export function perfDriftVisibility(
  selected: string[] | undefined,
  problemType: ProblemType,
): PerfDriftVisibility {
  const ev = evaluationMetricVisibility(selected, problemType);
  if (problemType === "regression") {
    return {
      ...ev,
      showClassificationBlock: ev.hasAny,
      showDiscriminationBlock: ev.hasAny,
      showRankOrderBlock: false,
      showInterpretabilityBlock: false,
      showScorePsi: false,
      showRoc: false,
      showKsCurve: false,
      showCalibrationChart: false,
      showDecileLift: false,
      showShap: false,
    };
  }
  const clsBlock =
    ev.showAuc || ev.showKs || ev.showGini || ev.showCalibration;
  const discBlock =
    ev.showAuc || ev.showKs || ev.showGini || ev.showCalibration;
  return {
    ...ev,
    showClassificationBlock: clsBlock,
    showDiscriminationBlock: discBlock,
    showRankOrderBlock: ev.showRankOrderBreak,
    // Backend always computes SHAP/PDP for classification; show whenever any perf metric is selected.
    showInterpretabilityBlock: ev.hasAny,
    showScorePsi: ev.showAuc,
    showRoc: ev.showAuc,
    showKsCurve: ev.showKs,
    showCalibrationChart: ev.showCalibration,
    showDecileLift: ev.showLift || ev.showRankOrderBreak,
    showShap: ev.hasAny,
  };
}

/** Resolve inventory configs for the active model (model_id key). */
export function inventoryMetricsForModel(
  inventoryConfigs: Record<string, string[]>,
  modelId: string | undefined,
): string[] {
  if (!modelId) return [];
  return inventoryConfigs[modelId] ?? [];
}

export function metricsSelectionKey(metrics: string[]): string {
  return [...metrics].sort().join("\u0001");
}

export function hasInventoryMetric(selected: string[] | undefined, metric: string): boolean {
  return (selected ?? []).includes(metric);
}
