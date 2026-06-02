import { INGESTION_DATASETS } from "@/config/datasets";

const DEV = INGESTION_DATASETS.dev_data.label;
const HOLD = INGESTION_DATASETS.hold_data.label;

export const DIAGNOSTICS_TABS = [
  { id: "data", label: "Data Drift", benchmark: DEV },
  { id: "concept", label: "Concept Drift", benchmark: DEV },
  { id: "performance", label: "Performance Drift", benchmark: HOLD },
  { id: "summary", label: "Summary", benchmark: HOLD },
] as const;

/** Section order when rendering combined Data Drift view (no nested tabs). */
export const DATA_DRIFT_SECTIONS = [
  { id: "descriptive", label: "Descriptive Stats" },
  { id: "cardinality", label: "Cardinality & Missing" },
  { id: "target", label: "Target Drift" },
  { id: "feature", label: "Feature Drift" },
] as const;

export const CONCEPT_DRIFT_SECTIONS = [
  { id: "iv", label: "IV & Univariate Gini" },
  { id: "monotonicity", label: "Bivariate" },
] as const;

export const PERFORMANCE_DRIFT_SECTIONS = [
  { id: "classification", label: "Classification" },
  { id: "discrimination", label: "Discrimination" },
  { id: "rank", label: "Rank Order & Lift" },
  { id: "interpretability", label: "Interpretability" },
] as const;

/** @deprecated Use section arrays; kept for any legacy imports. */
export const DATA_SUBTABS = DATA_DRIFT_SECTIONS;
export const CONCEPT_SUBTABS = CONCEPT_DRIFT_SECTIONS;
export const PERFORMANCE_SUBTABS = PERFORMANCE_DRIFT_SECTIONS;

export const DIAGNOSTIC_FINAL_ACTIONS = [
  { id: "no_action", label: "Do not recalibrate", recalibrationAction: "no_action" },
  { id: "recal_same_hp", label: "Recalibrate — same hyperparameters", recalibrationAction: "recal_simple" },
  { id: "recal_with_hp_opt", label: "Recalibrate — with hyperparameter optimisation", recalibrationAction: "recal_opt" },
  { id: "model_redevelopment", label: "Model redevelopment", recalibrationAction: "model_redevelopment" },
] as const;

/** Human-readable recalibration path for export / model card (from diagnostics selection). */
export function recalibrationDecisionLabel(action: string | undefined | null): string {
  const key = String(action || "").trim().toLowerCase();
  if (!key || key === "no_action") {
    return DIAGNOSTIC_FINAL_ACTIONS.find((a) => a.recalibrationAction === "no_action")?.label ?? "Do not recalibrate";
  }
  const match = DIAGNOSTIC_FINAL_ACTIONS.find((a) => a.recalibrationAction === key);
  if (match) return match.label;
  if (key === "redevelop") {
    return DIAGNOSTIC_FINAL_ACTIONS.find((a) => a.id === "model_redevelopment")?.label ?? "Model redevelopment";
  }
  return key.replace(/_/g, " ");
}

export function usesHyperparameterOptimization(action: string | undefined | null): boolean {
  const key = String(action || "").trim().toLowerCase();
  return key === "recal_opt" || key === "redevelop" || key === "model_redevelopment";
}

/** User-facing English copy for diagnostic decision actions. */
export const DIAGNOSTIC_ACTION_MESSAGES = {
  recal_same_hp: {
    summary:
      "Re-fit the champion model on current Development and New data using the same hyperparameters already stored with the uploaded model.",
    detail:
      "No hyperparameter search is run. This path is faster and keeps training settings aligned with the approved inventory model. Choose this when drift is mainly in the population or target rate, and concept-level signals (IV, monotonicity) have not broken down severely.",
  },
  recal_with_hp_opt: {
    summary:
      "Re-fit the model with hyperparameter optimization (search method from model inventory) to recover ranking and calibration on the new cohort.",
    detail:
      "A cross-validated search explores the hyperparameter space you confirm below, then the best trial is trained for export. Choose this when concept drift, a material drop in AUC or KS, or strong score PSI suggest the champion settings no longer fit the new data.",
  },
} as const;
