import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, Circle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { allIngestionDatasetLabels, INGESTION_DATASETS } from "@/config/datasets";
import { agentEventsUrl, getAgentResult, getAgentStatus, type AgentName } from "@/services/api";

const DEV = INGESTION_DATASETS.dev_data.label;
const NEW = INGESTION_DATASETS.new_data.label;
const HOLD = INGESTION_DATASETS.hold_data.label;
const NEW_VAL = INGESTION_DATASETS.new_data_oos.label;
const ALL_DATASETS = allIngestionDatasetLabels();

export interface TaskItem {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  output?: string;
  detail?: string;
}

export interface AgentStepperProps {
  sessionId: string;
  agent: AgentName;
  onCompleted?: (result: unknown) => void;
  onFailed?: (error: string) => void;
  /** Called once when the SSE stream is open — use to start the agent after the client is listening. */
  onStreamConnected?: () => void;
}

const DEFAULT_AGENT_TASKS: Partial<Record<AgentName, TaskItem[]>> = {
  ingestion: [
    { id: "parse_dev_data", name: `Parse ${DEV}`, status: "pending" },
    { id: "parse_new_data", name: `Parse ${NEW}`, status: "pending" },
    { id: "parse_hold_data", name: `Parse ${HOLD}`, status: "pending" },
    { id: "refinement", name: `Refinement — reconcile schemas (${ALL_DATASETS})`, status: "pending" },
    { id: "parse_new_data_oos", name: `Parse ${NEW_VAL}`, status: "pending" },
    { id: "load_model_object", name: "Load model object", status: "pending" },
    { id: "validate_preprocessing_code", name: "Validate preprocessing code", status: "pending" },
    { id: "validate_feature_engineering_code", name: "Validate feature engineering code", status: "pending" },
  ],
  reproducibility: [
    { id: "apply_preprocessing", name: `Apply preprocessing (${ALL_DATASETS})`, status: "pending" },
    { id: "apply_feature_engineering", name: `Apply feature engineering (${ALL_DATASETS})`, status: "pending" },
    { id: "score_dev_data", name: `Score ${DEV} with model`, status: "pending" },
    { id: "score_new_data", name: `Score ${NEW} with model`, status: "pending" },
    { id: "score_hold_data", name: `Score ${HOLD} with model`, status: "pending" },
    { id: "score_new_data_oos", name: `Score ${NEW_VAL} with model`, status: "pending" },
    { id: "predict_new_outcome", name: "Finalize outcomes and persist artifacts", status: "pending" },
    { id: "compare_to_original", name: "Compare to original scores (Spearman ρ)", status: "pending" },
    { id: "evaluate_threshold", name: "Evaluate reproducibility threshold", status: "pending" },
  ],
  drift: [
    { id: "load_context", name: "Load datasets, model and governance", status: "pending" },
    { id: "compute_data_drift", name: "Compute data drift diagnostics", status: "pending" },
    { id: "compute_concept_drift", name: "Compute concept drift diagnostics", status: "pending" },
    { id: "compute_performance_drift", name: "Compute performance drift diagnostics", status: "pending" },
    { id: "compute_interpretability", name: "Compute interpretability diagnostics", status: "pending" },
    { id: "assemble_report", name: "Assemble report and recommendation", status: "pending" },
  ],
  recalibration: [
    { id: "apply_variable_drops", name: "Apply variable drops", status: "pending" },
    { id: "prepare_training_data", name: "Prepare train and OOT feature matrices", status: "pending" },
    { id: "setup_hp_search", name: "Set up hyperparameter search", status: "pending" },
    { id: "run_hp_tuning", name: "Run hyperparameter tuning (30 trials)", status: "pending" },
    { id: "train_final_model", name: "Train final model on best hyperparameters", status: "pending" },
    { id: "score_oot", name: `Score ${NEW_VAL}`, status: "pending" },
    { id: "serialize_new_model", name: "Serialize new model object", status: "pending" },
  ],
  evaluation: [
    { id: "score_oot_with_original", name: `Score ${HOLD} and ${NEW_VAL} (champion + recalibrated)`, status: "pending" },
    { id: "compute_performance_metrics", name: "Compute performance metrics (AUC, KS, lift)", status: "pending" },
    { id: "compute_variable_experience", name: "Compute variable importance comparison", status: "pending" },
    { id: "compute_score_migration", name: "Compute 10×10 score migration matrix", status: "pending" },
    { id: "compute_top_decile_overlap", name: "Compute top-decile customer overlap (Jaccard)", status: "pending" },
    { id: "assemble_export_artifacts", name: "Assemble export artifacts", status: "pending" },
  ],
};

/** Static explanation shown under each step title (what the step does). */
const TASK_HELP: Partial<Record<AgentName, Record<string, string>>> = {
  ingestion: {
    parse_dev_data: `Read and validate the ${DEV} upload; infer schema, dtypes, and row counts.`,
    parse_new_data: `Read and validate the ${NEW} upload used for drift comparison.`,
    parse_hold_data: `Load the ${HOLD} upload if provided.`,
    refinement: `Align column names and types across ${ALL_DATASETS} so downstream scoring uses a consistent schema.`,
    parse_new_data_oos: `Load the ${NEW_VAL} upload when provided.`,
    load_model_object: "Deserialize the model .pkl and extract feature names, score column, and problem type.",
    validate_preprocessing_code: "Execute preprocessing script against sample rows to ensure it runs without error.",
    validate_feature_engineering_code: "Execute feature engineering script and confirm output columns match model expectations.",
  },
  reproducibility: {
    apply_preprocessing: `Run the model preprocessing pipeline on ${ALL_DATASETS} and write processed parquet/CSV artifacts.`,
    apply_feature_engineering: `Apply feature engineering to produce model-ready matrices for ${ALL_DATASETS}.`,
    score_dev_data: `Score ${DEV} with the loaded model and attach score / predicted_proba columns.`,
    score_new_data: `Score ${NEW} with the same model for drift and comparison workflows.`,
    score_hold_data: `Score ${HOLD} when available.`,
    score_new_data_oos: `Score ${NEW_VAL} when available.`,
    predict_new_outcome: `Derive or attach outcome columns on ${NEW} and persist export paths on the session.`,
    compare_to_original: `Compare freshly scored ${DEV} scores to bundled reference scores via Spearman correlation.`,
    evaluate_threshold: "Apply the reproducibility threshold and set pass/fail verdict for the workflow gate.",
  },
  drift: {
    load_context: `Load processed ${DEV}, ${NEW}, ${HOLD}, and ${NEW_VAL}; model feature list from .pkl; thresholds from inventory.`,
    compute_data_drift: `Compute PSI, CSI, missingness, cardinality, and target-rate drift between ${DEV} and ${NEW}.`,
    compute_concept_drift: `Compute IV, univariate AUC, and bivariate monotonicity on model features (${DEV} vs ${NEW}).`,
    compute_performance_drift: `Compare ROC, KS, lift, and calibration between ${HOLD} and ${NEW_VAL}.`,
    compute_interpretability: "Compute SHAP-style feature importance and partial dependence profiles where configured.",
    assemble_report: "Merge all diagnostic signals, apply governance rules, and produce the recommendation verdict.",
  },
  recalibration: {
    apply_variable_drops: "Remove variables flagged during diagnostics from the training feature set.",
    prepare_training_data: "Build train and out-of-time matrices with aligned labels and weights.",
    setup_hp_search: "Configure search space and optimization method from inventory settings.",
    run_hp_tuning: "Run cross-validated hyperparameter search trials and track best score.",
    train_final_model: "Fit the final model using the best hyperparameters on the full training window.",
    score_oot: `Score ${NEW_VAL} with the recalibrated model for evaluation.`,
    serialize_new_model: "Write the new model .pkl and update session paths for export.",
  },
  evaluation: {
    score_oot_with_original:
      `Score ${HOLD} and ${NEW_VAL} with champion and recalibrated models.`,
    compute_performance_metrics:
      `Calculate inventory-selected metrics for champion on ${HOLD} and ${NEW_VAL}, and recalibrated on ${NEW_VAL}.`,
    compute_variable_experience: "Compare feature importance ranks between champion and recalibrated models.",
    compute_score_migration:
      `Build decile migration matrix on ${NEW_VAL} between champion and recalibrated scores.`,
    compute_top_decile_overlap:
      `Measure Jaccard overlap of top-decile accounts on ${NEW_VAL} between champion and recalibrated models.`,
    assemble_export_artifacts: "Package evaluation tables and charts for download/export.",
  },
};

const STATUS_ICON = {
  pending: <Circle className="h-4 w-4 text-muted-foreground/40" />,
  running: <Loader2 className="h-4 w-4 text-primary animate-spin" />,
  completed: <CheckCircle className="h-4 w-4 text-emerald-400" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
};

function buildTasksFromEvents(
  defaults: TaskItem[],
  events: Record<string, unknown>[],
): { tasks: TaskItem[]; logs: string[]; progressPct: number } {
  const tasks = defaults.map((t) => ({ ...t }));
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const logs: string[] = ["Connected to agent"];
  let progressPct = 0;

  for (const evt of events) {
    const type = String(evt.event_type ?? "");
    if (type === "connected") continue;
    if (type === "heartbeat") continue;
    if (type === "started") {
      logs.push("▶ Agent started");
      continue;
    }
    if (type === "task") {
      const id = String(evt.task_id ?? "");
      const row = byId[id];
      if (!row) continue;
      const taskStatus = String(evt.task_status ?? "pending") as TaskItem["status"];
      row.status = taskStatus;
      row.name = String(evt.task_name || row.name);
      const summary = (evt.output as { summary?: string } | undefined)?.summary;
      if (taskStatus === "completed") {
        row.output = summary;
        row.detail = undefined;
        logs.push(`✓ ${row.name}${summary ? ` — ${summary}` : ""}`);
      } else if (taskStatus === "failed") {
        row.output = String(evt.message ?? "failed");
        row.detail = undefined;
        logs.push(`✗ ${row.name}: ${row.output}`);
      } else if (taskStatus === "running") {
        row.detail = row.detail ?? undefined;
        logs.push(`⏳ ${row.name}`);
      }
      continue;
    }
    if (type === "log") {
      const message = String(evt.message ?? "");
      if (message) {
        logs.push(message);
        const running = tasks.find((t) => t.status === "running");
        if (running) running.detail = message;
      }
      continue;
    }
    if (type === "progress") {
      progressPct = Math.round(Number(evt.progress ?? 0) * 100);
    }
  }

  return { tasks, logs, progressPct };
}

export function AgentStepper({ sessionId, agent, onCompleted, onFailed, onStreamConnected }: AgentStepperProps) {
  const [tasks, setTasks] = useState<TaskItem[]>(DEFAULT_AGENT_TASKS[agent] ?? []);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "failed">("running");
  const [showLogs, setShowLogs] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const reconnectAttemptsRef = useRef(0);
  const completedNotifiedRef = useRef(false);
  const streamConnectedRef = useRef(false);
  const eventsRef = useRef<Record<string, unknown>[]>([]);

  const taskHelp = TASK_HELP[agent] ?? {};
  const defaultTasks = DEFAULT_AGENT_TASKS[agent] ?? [];

  const syncFromEvents = (events: Record<string, unknown>[]) => {
    const { tasks: nextTasks, logs: nextLogs, progressPct } = buildTasksFromEvents(defaultTasks, events);
    setTasks(nextTasks);
    setLogs(nextLogs);
    if (progressPct > 0) setProgress(progressPct);
  };

  const finishCompleted = (output: unknown) => {
    reconnectAttemptsRef.current = 0;
    setStatus("completed");
    setProgress(100);
    setLogs((l) => [...l, `✅ Agent ${agent} completed`]);
    esRef.current?.close();
    if (!completedNotifiedRef.current) {
      completedNotifiedRef.current = true;
      onCompleted?.(output);
    }
  };

  const finishFailed = (message: string) => {
    reconnectAttemptsRef.current = 0;
    setStatus("failed");
    setLogs((l) => [...l, `❌ Agent ${agent} failed: ${message}`]);
    esRef.current?.close();
    if (!completedNotifiedRef.current) {
      completedNotifiedRef.current = true;
      onFailed?.(message);
    }
  };

  useEffect(() => {
    if (!sessionId) return;
    eventsRef.current = [];
    setTasks(defaultTasks);
    setLogs(["Connecting…"]);
    setProgress(0);
    setStatus("running");
    streamConnectedRef.current = false;
    completedNotifiedRef.current = false;

    const pollStatus = () => {
      void getAgentStatus(sessionId, agent)
        .then((snap) => {
          if (statusRef.current === "completed" || statusRef.current === "failed") return;
          if (snap.status === "not_started") return;
          const events = snap.events ?? [];
          if (events.length > 0) {
            eventsRef.current = events;
            syncFromEvents(events);
          }
          if (snap.status === "completed") {
            finishCompleted(snap.result);
          } else if (snap.status === "failed") {
            finishFailed("Agent execution failed");
          }
        })
        .catch(() => {
          // ignore transient poll errors
        });
    };

    pollStatus();
    const pollTimer = window.setInterval(pollStatus, 1200);

    const url = agentEventsUrl(sessionId, agent);
    const es = new EventSource(url);
    esRef.current = es;

    const notifyStreamConnected = () => {
      if (streamConnectedRef.current) return;
      streamConnectedRef.current = true;
      setLogs((l) => (l[0] === "Connecting…" ? [`Live stream · ${agent} agent`] : l));
      onStreamConnected?.();
    };

    es.onopen = () => notifyStreamConnected();

    es.onmessage = (e) => {
      notifyStreamConnected();
      try {
        const evt = JSON.parse(e.data) as Record<string, unknown>;
        const type = String(evt.event_type ?? "");
        if (type === "heartbeat" || type === "connected") return;

        if (type !== "completed" && type !== "failed") {
          eventsRef.current = [...eventsRef.current, evt];
          syncFromEvents(eventsRef.current);
        }

        if (type === "completed") {
          finishCompleted(evt.output);
        } else if (type === "failed") {
          finishFailed(String(evt.message ?? "Agent execution failed"));
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      if (statusRef.current !== "completed" && statusRef.current !== "failed") {
        void getAgentResult(sessionId, agent)
          .then((res) => {
            if (res.status === "completed") {
              setStatus("completed");
              setLogs((l) => [...l, `✅ Agent ${agent} completed`]);
              if (!completedNotifiedRef.current) {
                completedNotifiedRef.current = true;
                onCompleted?.(res.result);
              }
              return;
            }
            if (res.status === "failed") {
              setStatus("failed");
              const message = "Agent execution failed";
              setLogs((l) => [...l, `❌ Agent ${agent} failed: ${message}`]);
              if (!completedNotifiedRef.current) {
                completedNotifiedRef.current = true;
                onFailed?.(message);
              }
              return;
            }
            reconnectAttemptsRef.current += 1;
            if (reconnectAttemptsRef.current <= 3) {
              setLogs((l) => [...l, "Connection interrupted — retrying stream…"]);
              return;
            }
            setStatus("failed");
            setLogs((l) => [...l, "Connection error — stream closed"]);
            onFailed?.("Connection error — stream closed");
          })
          .catch(() => {
            reconnectAttemptsRef.current += 1;
            if (reconnectAttemptsRef.current <= 3) {
              setLogs((l) => [...l, "Connection interrupted — retrying stream…"]);
              return;
            }
            setStatus("failed");
            setLogs((l) => [...l, "Connection error — stream closed"]);
            onFailed?.("Connection error — stream closed");
          });
      }
      if (statusRef.current === "completed" || statusRef.current === "failed") {
        es.close();
      }
    };

    return () => {
      window.clearInterval(pollTimer);
      es.close();
    };
  }, [sessionId, agent]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const totalCount = tasks.length;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : progress;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
        <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
        {status === "completed" && (
          <span className="text-xs text-emerald-400 font-medium">Done</span>
        )}
        {status === "failed" && (
          <span className="text-xs text-destructive font-medium">Failed</span>
        )}
      </div>

      <div className="space-y-1">
        <AnimatePresence initial={false}>
          {tasks.length === 0 && (
            <p className="text-sm text-muted-foreground px-3 py-2">Waiting for agent tasks…</p>
          )}
          {tasks.map((task) => {
            const help = taskHelp[task.id];
            const showHelp = task.status === "running" || task.status === "completed";
            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex items-start gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  task.status === "running"
                    ? "bg-primary/8 border border-primary/20"
                    : task.status === "completed"
                    ? "text-foreground/80"
                    : task.status === "failed"
                    ? "bg-destructive/8 border border-destructive/20"
                    : "text-muted-foreground"
                }`}
              >
                <span className="mt-0.5 shrink-0">{STATUS_ICON[task.status]}</span>
                <div className="flex-1 min-w-0">
                  <p className={task.status === "pending" ? "opacity-40" : "font-medium"}>{task.name}</p>
                  {help && task.status === "running" && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{help}</p>
                  )}
                  {task.detail && task.status === "running" && (
                    <p className="text-xs text-primary/90 mt-1 leading-relaxed">{task.detail}</p>
                  )}
                  {task.output && (task.status === "completed" || task.status === "failed") && (
                    <p className="text-xs text-emerald-400/90 mt-1 leading-relaxed">{task.output}</p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setShowLogs((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground bg-muted/30 transition-colors"
        >
          <span className="font-mono uppercase tracking-wider">Console</span>
          {showLogs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <AnimatePresence>
          {showLogs && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              exit={{ height: 0 }}
              style={{ overflow: "hidden" }}
            >
              <div
                ref={logRef}
                className="font-mono text-xs text-muted-foreground bg-sidebar p-3 max-h-52 overflow-y-auto space-y-0.5"
              >
                {logs.map((line, i) => (
                  <div key={i} className="log-line leading-relaxed">
                    {line}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
