export type DiagnosticsTabId = "data" | "concept" | "performance";
export type DiagnosticActionId =
  | "no_action"
  | "recal_same_hp"
  | "recal_with_hp_opt"
  | "model_redevelopment";

export interface GovernanceConfig {
  csi?: { stable_max: number; medium_max: number };
  psi_score?: { stable_max: number; medium_max: number };
  iv?: { significant_decline: number; weakened_decline: number };
  missing?: { flag_delta_pp: number; critical_delta_pp: number };
  performance?: { auc_material_drop_pp: number; auc_moderate_drop_pp: number; ks_material_drop_pp: number };
  shap?: {
    feature_set_overlap_min: number;
    rank_shift_min_positions: number;
    mass_drop_pp: number;
  };
}

export interface DiagnosticDecisionPayload {
  session_id: string;
  gate: "interim_target" | "interim_feature" | "final";
  selection: DiagnosticActionId;
  rationale: string;
}

export interface DiagnosticsReport {
  version?: string;
  governance?: GovernanceConfig;
  datasets?: Record<string, unknown>;
  data_drift?: Record<string, unknown>;
  concept_drift?: Record<string, unknown>;
  performance_drift?: Record<string, unknown>;
  interpretability?: Record<string, unknown>;
  signal_grid?: Record<string, unknown>;
  recommendation?: { action?: DiagnosticActionId; rationale?: string };
  [key: string]: unknown;
}
