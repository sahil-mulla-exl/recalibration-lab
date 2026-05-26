export type ClassificationMetrics = {
  threshold?: number;
  tp?: number;
  fp?: number;
  tn?: number;
  fn?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  accuracy?: number;
};

export type ThresholdMode = "current" | "ks" | "f1";

type ThresholdBundle = Record<
  ThresholdMode,
  { threshold?: number; dev?: ClassificationMetrics; new?: ClassificationMetrics }
>;

export function metricsAtThreshold(
  perf: Record<string, unknown>,
  mode: ThresholdMode,
): { threshold: number; dev: ClassificationMetrics; new: ClassificationMetrics } {
  const bundle = perf.classification_by_threshold as ThresholdBundle | undefined;
  const entry = bundle?.[mode];
  if (entry?.dev && entry?.new) {
    return {
      threshold: Number(entry.threshold ?? perf.classification_threshold ?? 0.3),
      dev: entry.dev,
      new: entry.new,
    };
  }
  const thresholds = (perf.thresholds ?? {}) as { ks_optimal?: number; f1_optimal?: number };
  let threshold = Number(perf.classification_threshold ?? 0.3);
  if (mode === "ks") threshold = Number(thresholds.ks_optimal ?? threshold);
  if (mode === "f1") threshold = Number(thresholds.f1_optimal ?? threshold);
  return {
    threshold,
    dev: (perf.classification_dev ?? {}) as ClassificationMetrics,
    new: (perf.classification_new ?? {}) as ClassificationMetrics,
  };
}

export const THRESHOLD_METRIC_ROWS = [
  { key: "precision" as const, label: "Precision" },
  { key: "recall" as const, label: "Recall" },
  { key: "f1" as const, label: "F1" },
  { key: "accuracy" as const, label: "Accuracy" },
];
