const BASE = "/api";

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Session ──────────────────────────────────────────────────────────────────
export const initSession = () => apiFetch<{ session_id: string }>("/session/init", { method: "POST" });

export interface SessionCheckResponse {
  session_id: string;
  ok: boolean;
  model_features?: string[];
  model_feature_count?: number;
  model_meta?: {
    model_class?: string;
    feature_count?: number;
    n_estimators?: number;
  };
}

export const checkSession = (session_id: string) =>
  apiFetch<SessionCheckResponse>(`/session/${session_id}`);

// ── Inventory ─────────────────────────────────────────────────────────────────
export type OptimizationMethod = "random" | "bayesian" | "grid";

export interface ModelEntry {
  model_name: string;
  model_id: string;
  problem_type?: string;
  model_class: string;
  use_case: string;
  owner?: string;
  deployment_date?: string;
  last_refit_date?: string;
  scoring_path?: string;
  optimization_method?: OptimizationMethod;
  drift_verdict?: "hold" | "watch" | "recalibrate";
}

export function normalizeOptimizationMethod(value?: string): OptimizationMethod {
  const v = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "bayesian" || v === "bayesian_search" || v === "tpe") return "bayesian";
  if (v === "grid" || v === "grid_search") return "grid";
  if (v === "random" || v === "random_search") return "random";
  return "random";
}
export const getInventory = () => apiFetch<{ models: ModelEntry[]; count: number }>("/inventory/sample");
export const uploadInventory = async (file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}/inventory/upload`, { method: "POST", body: fd });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API /inventory/upload: ${res.status} ${text || res.statusText}`);
  }
  if (!text) return {};
  return JSON.parse(text);
};

// ── Workflow ──────────────────────────────────────────────────────────────────
export const selectModel = (
  session_id: string,
  model_id: string,
  model_entry: ModelEntry,
  inventory_metrics?: string[],
) =>
  apiFetch("/workflow/select-model", {
    method: "POST",
    body: JSON.stringify({ session_id, model_id, model_entry, inventory_metrics }),
  });

export const clearModelWorkflowState = (session_id: string) =>
  apiFetch("/workflow/clear-model", { method: "POST", body: JSON.stringify({ session_id }) });

// ── Ingestion ─────────────────────────────────────────────────────────────────
export const loadSamples = (session_id: string, target_variable?: string, outcome_variable?: string) =>
  apiFetch<Record<string, unknown>>("/ingestion/load-samples", {
    method: "POST",
    body: JSON.stringify({ session_id, target_variable, outcome_variable }),
  });

export const uploadFile = async (
  session_id: string,
  file: File,
  kind: string,
  target_variable?: string,
  outcome_variable?: string,
) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  fd.append("session_id", session_id);
  if (target_variable) fd.append("target_variable", target_variable);
  if (outcome_variable) fd.append("outcome_variable", outcome_variable);
  const res = await fetch(`${BASE}/ingestion/upload`, { method: "POST", body: fd });
  return res.json();
};

export const removeIngestionFile = (session_id: string, kind: string) =>
  apiFetch<Record<string, unknown>>("/ingestion/remove", {
    method: "POST",
    body: JSON.stringify({ session_id, kind }),
  });

export const configureIngestionVariables = (
  session_id: string,
  target_variable: string,
  outcome_variable: string,
) =>
  apiFetch<{
    ok?: boolean;
    error?: string;
    refreshed?: Record<string, unknown>;
  }>("/ingestion/configure-variables", {
    method: "POST",
    body: JSON.stringify({ session_id, target_variable, outcome_variable }),
  });

// ── Agents ─────────────────────────────────────────────────────────────────────
export type AgentName = "ingestion" | "reproducibility" | "drift" | "recalibration" | "evaluation";

export const runAgent = (session_id: string, agent: AgentName, params?: Record<string, unknown>) =>
  apiFetch<{ run_id?: string; status?: string; error?: string }>(`/agents/${agent}/run`, {
    method: "POST",
    body: JSON.stringify({ session_id, params }),
  }).then((res) => {
    if (res?.error) {
      throw new Error(res.error);
    }
    return res as { run_id: string; status: string };
  });

export const getAgentResult = (session_id: string, agent: AgentName) =>
  apiFetch<{ status: string; result: unknown }>(`/agents/${agent}/result?session_id=${session_id}`);

export const getAgentStatus = (session_id: string, agent: AgentName) =>
  apiFetch<{ status: string; events: Record<string, unknown>[]; result: unknown }>(
    `/agents/${agent}/status?session_id=${session_id}`,
  );

export const agentEventsUrl = (session_id: string, agent: AgentName) =>
  `${BASE}/agents/${agent}/events?session_id=${session_id}`;

// ── Diagnostics ───────────────────────────────────────────────────────────────
export const getDriftReport = (session_id: string) =>
  apiFetch<Record<string, unknown>>(`/diagnostics/report?session_id=${session_id}`);

export const getVariableDetail = (session_id: string, var_name: string) =>
  apiFetch<Record<string, unknown>>(`/diagnostics/variable/${var_name}?session_id=${session_id}`);

export const saveDiagnosticDecision = (
  session_id: string,
  gate: "interim_target" | "interim_feature" | "final",
  selection: "no_action" | "recal_same_hp" | "recal_with_hp_opt" | "model_redevelopment",
  rationale: string,
) =>
  apiFetch<{ ok: boolean; decision: Record<string, unknown> }>("/diagnostics/decision", {
    method: "POST",
    body: JSON.stringify({ session_id, gate, selection, rationale }),
  });

export const downloadDiagnosticsReport = (
  session_id: string,
  tab: "data" | "concept" | "performance" | "descriptive",
) => `${BASE}/diagnostics/download/${tab}?session_id=${session_id}`;

export const downloadDiagnosticsReportFile = async (
  session_id: string,
  tab: "data" | "concept" | "performance" | "descriptive",
  report?: Record<string, unknown>,
) => {
  const saveResponse = async (res: Response, fallbackName: string) => {
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const fileMatch = disposition.match(/filename="?([^"]+)"?/i);
    const filename = fileMatch?.[1] ?? fallbackName;
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  };

  // Prefer tab-scoped inline export from current in-memory report (selected tab context).
  if (report) {
    const postRes = await fetch(`${BASE}/diagnostics/download/${tab}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report }),
    });
    if (postRes.ok) {
      await saveResponse(postRes, `diagnostics_${tab}.xlsx`);
      return;
    }
    // Continue with GET fallback for compatibility with older backend builds.
  }

  const url = downloadDiagnosticsReport(session_id, tab);
  const getRes = await fetch(url);
  if (getRes.ok) {
    await saveResponse(getRes, `diagnostics_${tab}_${session_id}.xlsx`);
    return;
  }
  const text = await getRes.text().catch(() => getRes.statusText);
  throw new Error(`API /diagnostics/download/${tab}: ${getRes.status} ${text}`);
};

export const getGovernance = (session_id?: string) =>
  apiFetch<Record<string, unknown>>(
    session_id ? `/governance?session_id=${session_id}` : "/governance",
  );

// ── Recalibration ─────────────────────────────────────────────────────────────
export const configureRecalibration = (
  session_id: string,
  drops: string[],
  model_class: string,
  hp_method: string,
  cv_folds: number,
  search_space?: Record<string, { min?: number; max?: number; selected?: string[] }>,
  selected_action?: string,
) =>
  apiFetch("/recalibration/configure", {
    method: "POST",
    body: JSON.stringify({ session_id, drops, model_class, hp_method, cv_folds, search_space, selected_action }),
  });

// ── Evaluation ────────────────────────────────────────────────────────────────
export const getEvaluationReport = (session_id: string) =>
  apiFetch<Record<string, unknown>>(`/evaluation/report?session_id=${session_id}`);

// ── Export ────────────────────────────────────────────────────────────────────
export const exportModel = (session_id: string) => `${BASE}/export/model?session_id=${session_id}`;
export const exportLog = (session_id: string) => `${BASE}/export/log?session_id=${session_id}`;
export const exportReport = (session_id: string) => `${BASE}/export/report?session_id=${session_id}`;
export const exportProcessedData = (
  session_id: string,
  dataset: "dev" | "new" | "hold" | "oot" = "dev",
  format: "csv" | "parquet" = "csv",
) => `${BASE}/export/processed-data?session_id=${session_id}&dataset=${dataset}&format=${format}`;
export const exportScoreComparison = (
  session_id: string,
  dataset: "dev" | "new" = "dev",
  reference_path?: string,
  format: "csv" | "xlsx" = "csv",
) => {
  const params = new URLSearchParams({ session_id, dataset, format });
  if (reference_path) params.set("reference_path", reference_path);
  return `${BASE}/export/score-comparison?${params.toString()}`;
};

export const exportProcessingWorkbook = (session_id: string, dataset: "dev" | "new" = "dev") =>
  `${BASE}/export/processing-workbook?session_id=${session_id}&dataset=${dataset}`;

export type ScoreComparisonData = {
  path?: string;
  filename?: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total_rows: number;
  offset: number;
  limit: number;
  summary: Record<string, unknown>;
  error?: string;
};

export const getScoreComparisonData = (
  session_id: string,
  dataset: "dev" | "new" = "dev",
  limit = 100,
  offset = 0,
) =>
  apiFetch<ScoreComparisonData>(
    `/export/score-comparison-data?session_id=${session_id}&dataset=${dataset}&limit=${limit}&offset=${offset}`,
  );
