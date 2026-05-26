import { INGESTION_DATASETS } from "@/config/datasets";

const OLD_HOLDOUT = `${INGESTION_DATASETS.hold_data.label} (Old Holdout)`;
const NEW_HOLDOUT = `${INGESTION_DATASETS.new_data_oos.label} (New Holdout)`;

/** Evaluation chart / table series labels (three cohorts). */
export const EVALUATION_SERIES = {
  championHold: `Champion Model — ${OLD_HOLDOUT}`,
  championOos: `Champion Model — ${NEW_HOLDOUT}`,
  recalibratedOos: `Recalibrated Model — ${NEW_HOLDOUT}`,
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
  // Backward-compatible keys from older evaluation payloads
  Champion: EVALUATION_SERIES.championOos,
  Recalibrated: EVALUATION_SERIES.recalibratedOos,
};

export function evaluationChartLabel(dataKey: string | number | undefined, fallback?: string): string {
  const key = String(dataKey ?? "");
  return EVALUATION_CHART_LABELS[key] ?? fallback ?? key;
}
