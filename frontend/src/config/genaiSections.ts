/** Maps UI section ids → AI response heading keywords (lowercase). */

export const PERFORMANCE_GENAI_SECTIONS = {
  classification: ["precision, recall", "precision recall", "metric deltas", "thresholds", "f1", "accuracy"],
  discrimination: ["model discrimination", "score psi", "calibration", "auc, ks", "performance radar"],
  rank: ["rank order", "rank monotonicity", "decile event", "lift"],
  interpretability: ["interpretability", "shap importance", "shap"],
} as const;

export const DATA_GENAI_SECTIONS = {
  descriptive: ["per-feature distribution", "per feature distribution", "drift shape"],
  cardinality: ["cardinality change", "cardinality", "missing rate"],
  target: ["target drift", "event rate"],
  feature: ["feature drift", "csi ranking", "csi"],
} as const;

export const CONCEPT_GENAI_SECTIONS = {
  iv: ["information value", "univariate variable auc", "univariate auc", "iv decline"],
  monotonicity: ["bivariate relationship", "bivariate", "monotonicity"],
} as const;

export const EVALUATION_GENAI_SECTIONS = {
  metrics: ["headline metric", "recovery vs baseline", "metric comparison"],
  rank: ["rank order", "monotonicity status", "decile event"],
  lift: ["cumulative lift", "top decile lift"],
  importance: ["feature importance", "native importance", "shap importance", "shap"],
  recommended: ["recommended action", "recalibration improvement", "deployment verdict", "improved:"],
} as const;

export type PerformanceGenAiSectionId = keyof typeof PERFORMANCE_GENAI_SECTIONS;
export type DataGenAiSectionId = keyof typeof DATA_GENAI_SECTIONS;
export type ConceptGenAiSectionId = keyof typeof CONCEPT_GENAI_SECTIONS;
export type EvaluationGenAiSectionId = keyof typeof EVALUATION_GENAI_SECTIONS;
