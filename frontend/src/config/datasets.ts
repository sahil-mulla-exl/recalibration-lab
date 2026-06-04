/**
 * Canonical dataset names — must match Data Ingestion (`FILE_KINDS` labels).
 */
export const INGESTION_DATASETS = {
  dev_data: {
    id: "dev_data",
    label: "Existing Train Data",
    apiKey: "dev",
  },
  new_data: {
    id: "new_data",
    label: "New Train Data",
    apiKey: "new",
  },
  hold_data: {
    id: "hold_data",
    label: "Existing Test Data",
    apiKey: "hold",
  },
  new_data_oos: {
    id: "new_data_oos",
    label: "New Test Data",
    apiKey: "oot",
  },
} as const;

export type IngestionDatasetId = keyof typeof INGESTION_DATASETS;

/** Roles used in charts / tables (maps to ingestion labels). */
export type DatasetSeriesRole = "train" | "dev" | "new" | "hold" | "oot";

const SERIES_LABELS: Record<DatasetSeriesRole, string> = {
  train: INGESTION_DATASETS.dev_data.label,
  dev: INGESTION_DATASETS.dev_data.label,
  new: INGESTION_DATASETS.new_data.label,
  hold: INGESTION_DATASETS.hold_data.label,
  oot: INGESTION_DATASETS.new_data_oos.label,
};

/** Legend / chart series label for a cohort. */
export function datasetSeriesLabel(role: DatasetSeriesRole): string {
  return SERIES_LABELS[role];
}

/** Diagnostics benchmark row tiles (Summary banner). */
export const DIAGNOSTICS_BENCHMARK_TILES = [
  {
    rowsKey: "training_rows" as const,
    label: INGESTION_DATASETS.dev_data.label,
    hint: "Drift & concept baseline",
  },
  {
    rowsKey: "dev_oos_rows" as const,
    label: INGESTION_DATASETS.hold_data.label,
    hint: "Performance baseline",
  },
  {
    rowsKey: "new_rows" as const,
    label: INGESTION_DATASETS.new_data.label,
    hint: "Train append (recalibration)",
  },
  {
    rowsKey: "perf_new_rows" as const,
    label: INGESTION_DATASETS.new_data_oos.label,
    hint: "Data, concept & performance comparison",
  },
];

/** Recharts `dataKey` → display name for tooltips / legends. */
export function driftBaselineLabel(): string {
  return INGESTION_DATASETS.dev_data.label;
}

export function perfBaselineLabel(): string {
  return INGESTION_DATASETS.hold_data.label;
}

/** Comparison cohort on the Performance tab (New Test Data). */
export function perfNewLabel(): string {
  return INGESTION_DATASETS.new_data_oos.label;
}

/** Display label without trailing " Sample" (tables / compact headers). */
export function stripSampleLabel(label: string): string {
  return label.replace(/\s+Sample$/i, "");
}

export function perfBaselineShortLabel(): string {
  return stripSampleLabel(perfBaselineLabel());
}

export function perfNewShortLabel(): string {
  return stripSampleLabel(perfNewLabel());
}

/** Short delta column header for performance comparison tables. */
export function perfDeltaShortLabel(): string {
  return `Δ (${perfNewShortLabel()} − ${perfBaselineShortLabel()})`;
}

export const CHART_DATAKEY_LABELS: Record<string, string> = {
  trainPct: `${INGESTION_DATASETS.dev_data.label} %`,
  newPct: `${INGESTION_DATASETS.new_data_oos.label} %`,
  training: INGESTION_DATASETS.dev_data.label,
  newData: INGESTION_DATASETS.new_data_oos.label,
  trainAuc: INGESTION_DATASETS.dev_data.label,
  newAuc: INGESTION_DATASETS.new_data_oos.label,
  ivTrain: INGESTION_DATASETS.dev_data.label,
  ivNew: INGESTION_DATASETS.new_data_oos.label,
  devImportance: INGESTION_DATASETS.hold_data.label,
  newImportance: INGESTION_DATASETS.new_data_oos.label,
  dev: INGESTION_DATASETS.hold_data.label,
  new: INGESTION_DATASETS.new_data_oos.label,
  current: INGESTION_DATASETS.new_data_oos.label,
  trainEventRatePct: `${INGESTION_DATASETS.dev_data.label} event rate`,
  newEventRatePct: `${INGESTION_DATASETS.new_data_oos.label} event rate`,
};

export function chartDataKeyLabel(dataKey: string | number | undefined, fallback?: string): string {
  const key = String(dataKey ?? "");
  return CHART_DATAKEY_LABELS[key] ?? fallback ?? key;
}

export function driftCompareSubtitle(): string {
  return `${driftBaselineLabel()} vs ${INGESTION_DATASETS.new_data_oos.label}`;
}

export function perfCompareSubtitle(): string {
  return `${perfBaselineLabel()} vs ${perfNewLabel()}`;
}

/** Comma-separated list of all four ingestion cohort labels (Ingestion / Inventory naming). */
export function allIngestionDatasetLabels(): string {
  return [
    INGESTION_DATASETS.dev_data.label,
    INGESTION_DATASETS.new_data.label,
    INGESTION_DATASETS.hold_data.label,
    INGESTION_DATASETS.new_data_oos.label,
  ].join(", ");
}
