import { INGESTION_DATASETS } from "@/config/datasets";

/** Evaluation table / chart cohort column headers. */
export const EVALUATION_SERIES = {
  championHold: "PRODUCTION DEV VALIDATION",
  championOos: "PRODUCTION NEW VALIDATION",
  recalibratedOos: "RECAL NEW VALIDATION",
} as const;

/** Short keys used in Recharts `dataKey` fields. */
export const EVALUATION_DATA_KEYS = {
  championHold: "championHold",
  championOos: "championOos",
  recalibratedOos: "recalibratedOos",
} as const;

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
