export type RangeParam = {
  kind: "range";
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultMin: number;
  defaultMax: number;
  hint?: string;
};
export type ChoiceParam = {
  kind: "choice";
  name: string;
  label: string;
  options: string[];
  defaultSelected: string[];
  hint?: string;
};
export type HpParam = RangeParam | ChoiceParam;

export type SearchSpaceValue = Record<string, { min?: number; max?: number; selected?: string[] }>;

export const SEARCH_SPACES: Record<string, HpParam[]> = {
  XGBoost: [
    { kind: "range", name: "max_depth", label: "max_depth", min: 2, max: 15, step: 1, defaultMin: 3, defaultMax: 8, hint: "Tree depth" },
    { kind: "range", name: "learning_rate", label: "learning_rate", min: 0.01, max: 0.5, step: 0.01, defaultMin: 0.03, defaultMax: 0.2, hint: "η" },
    { kind: "range", name: "n_estimators", label: "n_estimators", min: 50, max: 1000, step: 10, defaultMin: 100, defaultMax: 400, hint: "Boosting rounds" },
    { kind: "range", name: "subsample", label: "subsample", min: 0.4, max: 1.0, step: 0.05, defaultMin: 0.7, defaultMax: 1.0, hint: "Row sample" },
    { kind: "range", name: "colsample_bytree", label: "colsample_bytree", min: 0.4, max: 1.0, step: 0.05, defaultMin: 0.7, defaultMax: 1.0, hint: "Col sample" },
    { kind: "range", name: "min_child_weight", label: "min_child_weight", min: 1, max: 20, step: 1, defaultMin: 1, defaultMax: 6, hint: "Min leaf weight" },
    { kind: "range", name: "reg_lambda", label: "reg_lambda", min: 0, max: 10, step: 0.5, defaultMin: 0.5, defaultMax: 5, hint: "L2 penalty" },
  ],
  LightGBM: [
    { kind: "range", name: "num_leaves", label: "num_leaves", min: 7, max: 255, step: 1, defaultMin: 15, defaultMax: 95, hint: "Leaves per tree" },
    { kind: "range", name: "learning_rate", label: "learning_rate", min: 0.01, max: 0.5, step: 0.01, defaultMin: 0.03, defaultMax: 0.2, hint: "η" },
    { kind: "range", name: "n_estimators", label: "n_estimators", min: 50, max: 1000, step: 10, defaultMin: 100, defaultMax: 400, hint: "Boosting rounds" },
    { kind: "range", name: "feature_fraction", label: "feature_fraction", min: 0.4, max: 1.0, step: 0.05, defaultMin: 0.7, defaultMax: 1.0, hint: "Col sample" },
    { kind: "range", name: "bagging_fraction", label: "bagging_fraction", min: 0.4, max: 1.0, step: 0.05, defaultMin: 0.7, defaultMax: 1.0, hint: "Row sample" },
    { kind: "range", name: "min_child_samples", label: "min_child_samples", min: 5, max: 100, step: 1, defaultMin: 10, defaultMax: 40, hint: "Min leaf samples" },
    { kind: "range", name: "max_depth", label: "max_depth", min: -1, max: 15, step: 1, defaultMin: -1, defaultMax: 12, hint: "-1 = no limit" },
  ],
  GBM: [
    { kind: "range", name: "max_depth", label: "max_depth", min: 2, max: 12, step: 1, defaultMin: 3, defaultMax: 8, hint: "Tree depth" },
    { kind: "range", name: "learning_rate", label: "learning_rate", min: 0.01, max: 0.5, step: 0.01, defaultMin: 0.03, defaultMax: 0.2 },
    { kind: "range", name: "n_estimators", label: "n_estimators", min: 50, max: 1000, step: 10, defaultMin: 100, defaultMax: 400 },
    { kind: "range", name: "subsample", label: "subsample", min: 0.4, max: 1.0, step: 0.05, defaultMin: 0.7, defaultMax: 1.0 },
    { kind: "range", name: "min_samples_split", label: "min_samples_split", min: 2, max: 50, step: 1, defaultMin: 2, defaultMax: 20 },
  ],
  Logistic: [
    { kind: "range", name: "C", label: "C (inverse reg.)", min: 0.001, max: 100, step: 0.01, defaultMin: 0.01, defaultMax: 10, hint: "log-scale sweep" },
    { kind: "choice", name: "penalty", label: "penalty", options: ["l1", "l2", "elasticnet"], defaultSelected: ["l2"], hint: "Regularisation" },
    { kind: "choice", name: "solver", label: "solver", options: ["liblinear", "saga", "lbfgs", "newton-cg"], defaultSelected: ["liblinear", "lbfgs"] },
    { kind: "range", name: "max_iter", label: "max_iter", min: 100, max: 5000, step: 100, defaultMin: 200, defaultMax: 2000 },
    { kind: "range", name: "l1_ratio", label: "l1_ratio", min: 0.0, max: 1.0, step: 0.05, defaultMin: 0.0, defaultMax: 1.0, hint: "Only for elasticnet" },
  ],
};

export function hpParamsForModel(modelClass: string): HpParam[] {
  return SEARCH_SPACES[modelClass] ?? SEARCH_SPACES.XGBoost;
}

export function buildDefaultSpace(modelClass: string): SearchSpaceValue {
  const params = hpParamsForModel(modelClass);
  const out: SearchSpaceValue = {};
  for (const p of params) {
    if (p.kind === "range") out[p.name] = { min: p.defaultMin, max: p.defaultMax };
    else out[p.name] = { selected: [...p.defaultSelected] };
  }
  return out;
}

export function mergeDiagnosticsSearchSpace(
  base: SearchSpaceValue,
  diag?: SearchSpaceValue,
): SearchSpaceValue {
  if (!diag || Object.keys(diag).length === 0) return base;
  return { ...base, ...diag };
}
