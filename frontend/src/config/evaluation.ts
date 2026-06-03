import type { KsCurvePoint } from "@/lib/ksCurve";

/** Evaluation table / chart cohort column headers. */
export const EVALUATION_SERIES = {
  championHold: "PRODUCTION DEV VALIDATION",
  championOos: "PRODUCTION NEW VALIDATION",
  recalibratedOos: "RECAL NEW VALIDATION",
} as const;

export type EvaluationCohortKey = "champion_hold" | "champion_oos" | "recalibrated_oos";

/** Short keys used in Recharts `dataKey` fields. */
export const EVALUATION_DATA_KEYS = {
  championHold: "championHold",
  championOos: "championOos",
  recalibratedOos: "recalibratedOos",
} as const;

/** Fixed evaluation KS cohorts (no dev / new drift cohorts). */
export const EVALUATION_KS_COHORTS: ReadonlyArray<{
  cohort: EvaluationCohortKey;
  key: (typeof EVALUATION_DATA_KEYS)[keyof typeof EVALUATION_DATA_KEYS];
  label: string;
  legacyCurveKey: string;
  colorKey: "train" | "dev" | "new";
}> = [
  {
    cohort: "champion_hold",
    key: EVALUATION_DATA_KEYS.championHold,
    label: EVALUATION_SERIES.championHold,
    legacyCurveKey: "champion_hold_ks_curve",
    colorKey: "train",
  },
  {
    cohort: "champion_oos",
    key: EVALUATION_DATA_KEYS.championOos,
    label: EVALUATION_SERIES.championOos,
    legacyCurveKey: "orig_ks_curve",
    colorKey: "dev",
  },
  {
    cohort: "recalibrated_oos",
    key: EVALUATION_DATA_KEYS.recalibratedOos,
    label: EVALUATION_SERIES.recalibratedOos,
    legacyCurveKey: "new_ks_curve",
    colorKey: "new",
  },
];

export function evaluationKsCurvePoints(
  report: Record<string, unknown> | null | undefined,
  cohort: EvaluationCohortKey,
): KsCurvePoint[] {
  if (!report) return [];
  const nested = report.evaluation_cohorts as Record<string, { ks_curve?: KsCurvePoint[] }> | undefined;
  const fromNested = nested?.[cohort]?.ks_curve;
  if (Array.isArray(fromNested) && fromNested.length > 0) return fromNested;
  const cfg = EVALUATION_KS_COHORTS.find((c) => c.cohort === cohort);
  if (!cfg) return [];
  const legacy = report[cfg.legacyCurveKey];
  return Array.isArray(legacy) ? (legacy as KsCurvePoint[]) : [];
}

export const EVALUATION_CHART_LABELS: Record<string, string> = {
  [EVALUATION_DATA_KEYS.championHold]: EVALUATION_SERIES.championHold,
  [EVALUATION_DATA_KEYS.championOos]: EVALUATION_SERIES.championOos,
  [EVALUATION_DATA_KEYS.recalibratedOos]: EVALUATION_SERIES.recalibratedOos,
  Champion: EVALUATION_SERIES.championOos,
  Recalibrated: EVALUATION_SERIES.recalibratedOos,
  Production: EVALUATION_SERIES.championOos,
};

export function evaluationChartLabel(dataKey: string | number | undefined, fallback?: string): string {
  const key = String(dataKey ?? "");
  return EVALUATION_CHART_LABELS[key] ?? fallback ?? key;
}
