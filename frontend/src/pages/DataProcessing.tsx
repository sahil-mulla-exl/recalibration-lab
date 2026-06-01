import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { INGESTION_DATASETS } from "@/config/datasets";
import { exportScoreComparison, runAgent } from "@/services/api";
import { usePersistedState, useSession } from "@/contexts/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AgentStepper } from "@/components/AgentStepper";

/** Color bands for score match percentage (within ±0.01 tolerance). */
function matchScoreStyle(pct: number | null): { label: string; card: string; value: string } {
  if (pct == null || Number.isNaN(pct)) {
    return {
      label: "Not available",
      card: "border-border bg-muted/15",
      value: "text-muted-foreground",
    };
  }
  if (pct >= 99) {
    return {
      label: "Excellent match",
      card: "border-emerald-500/40 bg-emerald-500/10",
      value: "text-emerald-400",
    };
  }
  if (pct >= 95) {
    return {
      label: "Good match",
      card: "border-amber-500/40 bg-amber-500/10",
      value: "text-amber-400",
    };
  }
  if (pct >= 90) {
    return {
      label: "Moderate match",
      card: "border-orange-500/40 bg-orange-500/10",
      value: "text-orange-400",
    };
  }
  return {
    label: "Low match",
    card: "border-red-500/40 bg-red-500/10",
    value: "text-red-400",
  };
}

export default function DataProcessing() {
  const [, navigate] = useLocation();
  const { sessionId, setStep, setDriftResult, selectedModel } = useSession();
  const [reproDone, setReproDone] = usePersistedState<boolean>("rcl:reproDone", false);
  const [processingRunning, setProcessingRunning] = useState(false);
  const [dataProcessingResult, setDataProcessingResult] = usePersistedState<Record<string, unknown> | null>(
    "rcl:dataProcessingResult",
    null
  );
  const [, setAutoRunDrift] = usePersistedState<boolean>("rcl:autoRunDrift", false);
  const agentLaunchRef = useRef(false);
  const [targetVariable] = usePersistedState<string>("rcl:targetVariable", "");
  const [outcomeVariable] = usePersistedState<string>("rcl:outcomeVariable", "");

  useEffect(() => {
    if (!sessionId || reproDone) return;
    setProcessingRunning(true);
  }, [sessionId, reproDone]);

  useEffect(() => {
    if (!sessionId || reproDone) return;
    if (agentLaunchRef.current) return;
    agentLaunchRef.current = true;
    void runAgent(sessionId, "reproducibility", {
      target_variable: targetVariable,
      outcome_variable: outcomeVariable,
    }).catch(() => {
      agentLaunchRef.current = false;
      setProcessingRunning(false);
    });
  }, [sessionId, reproDone, targetVariable, outcomeVariable]);

  const processingReport = dataProcessingResult || {};
  const comparisonSummary = (processingReport.score_comparison_summary || {}) as Record<string, unknown>;
  const rowsCompared = Number(comparisonSummary.rows_compared ?? 0);
  const pctMatchStrict =
    comparisonSummary.pct_within_0_01 != null ? Number(comparisonSummary.pct_within_0_01) : null;
  const pctMatchRelaxed =
    comparisonSummary.pct_within_0_05 != null ? Number(comparisonSummary.pct_within_0_05) : null;
  const matchPct = rowsCompared > 0 ? pctMatchStrict : null;
  const matchStyle = matchScoreStyle(matchPct);

  const modelFeaturesUsed = (processingReport.model_features_used as string[]) || [];
  const problemType = String(processingReport.problem_type || selectedModel?.problem_type || "classification")
    .toLowerCase()
    .startsWith("reg")
    ? "regression"
    : "classification";

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div>
        <Button variant="ghost" size="sm" className="text-muted-foreground mb-3 -ml-1" onClick={() => navigate("/ingestion")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back
        </Button>
        <h1 className="text-2xl font-bold">Data Processing</h1>
      </div>

      {!reproDone && (
        <Card className="p-5">
          <h2 className="font-semibold text-sm mb-4">Data Processing Agent</h2>
          {sessionId ? (
            <AgentStepper
              sessionId={sessionId}
              agent="reproducibility"
              onCompleted={(result) => {
                setReproDone(true);
                setDataProcessingResult((result as Record<string, unknown>) || {});
                setProcessingRunning(false);
              }}
              onFailed={() => {
                setProcessingRunning(false);
                agentLaunchRef.current = false;
              }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Waiting for session initialization...</p>
          )}
        </Card>
      )}

      {reproDone && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h3 className="font-semibold text-sm">Data Processing Outcomes</h3>
              {sessionId && rowsCompared > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5 h-8" asChild>
                  <a href={exportScoreComparison(sessionId, "dev")} download>
                    <Download className="h-3.5 w-3.5" />
                    Download score comparison CSV
                  </a>
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 text-sm">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{INGESTION_DATASETS.dev_data.label} rows</p>
                <p className="font-mono font-semibold mt-1">{Number(processingReport.dev_rows || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{INGESTION_DATASETS.new_data.label} rows</p>
                <p className="font-mono font-semibold mt-1">{Number(processingReport.new_rows || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{INGESTION_DATASETS.hold_data.label} rows</p>
                <p className="font-mono font-semibold mt-1">{Number(processingReport.hold_rows || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{INGESTION_DATASETS.new_data_oos.label} rows</p>
                <p className="font-mono font-semibold mt-1">{Number(processingReport.oos_rows || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{INGESTION_DATASETS.dev_data.label} mean score</p>
                <p className="font-mono font-semibold mt-1">{Number(processingReport.dev_score_mean || 0).toFixed(4)}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{INGESTION_DATASETS.new_data.label} mean score</p>
                <p className="font-mono font-semibold mt-1">{Number(processingReport.new_score_mean || 0).toFixed(4)}</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
              {String(processingReport.new_outcome_source || "") === "observed" ? (
                <>
                  <p className="font-medium text-primary">
                    New data outcome variable (from upload):{" "}
                    <span className="font-mono">{String(processingReport.new_outcome_column || outcomeVariable || "—")}</span>
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {problemType === "regression"
                      ? `Observed outcome mean: ${Number(processingReport.new_outcome_mean ?? processingReport.new_predicted_outcome_mean ?? 0).toFixed(4)}`
                      : `Observed positive rate: ${((Number(processingReport.new_outcome_rate ?? processingReport.new_predicted_outcome_rate ?? 0)) * 100).toFixed(2)}%`}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-primary">New data has no outcome column in upload</p>
                  <p className="text-muted-foreground mt-1">
                    Selected dev outcome: <span className="font-mono">{outcomeVariable || "—"}</span>.
                    Model-generated column: <span className="font-mono">predicted_outcome</span>.
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {problemType === "regression"
                      ? `Model-generated outcome mean: ${Number(processingReport.new_outcome_mean ?? processingReport.new_predicted_outcome_mean ?? 0).toFixed(4)}`
                      : `Model-generated positive rate: ${((Number(processingReport.new_outcome_rate ?? processingReport.new_predicted_outcome_rate ?? 0)) * 100).toFixed(2)}%`}
                  </p>
                </>
              )}
            </div>

            <div className={`mt-4 inline-block w-fit max-w-full rounded-lg border p-5 ${matchStyle.card}`}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Score Match Rate</p>
              {rowsCompared > 0 && matchPct != null ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-3 mt-2">
                    <p className={`text-4xl font-bold tabular-nums ${matchStyle.value}`}>
                      {matchPct.toFixed(1)}%
                    </p>
                    <span className={`text-sm font-semibold ${matchStyle.value}`}>{matchStyle.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 max-w-prose">
                    Share of {rowsCompared.toLocaleString()} development data rows where the platform score matches the user reference score within ±0.01.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs w-fit">
                    <div>
                      <span className="text-muted-foreground">Within ±0.01</span>
                      <p className={`font-mono font-semibold mt-0.5 ${matchScoreStyle(pctMatchStrict).value}`}>
                        {pctMatchStrict != null ? `${pctMatchStrict.toFixed(1)}%` : "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Within ±0.05</span>
                      <p className={`font-mono font-semibold mt-0.5 ${matchScoreStyle(pctMatchRelaxed).value}`}>
                        {pctMatchRelaxed != null ? `${pctMatchRelaxed.toFixed(1)}%` : "—"}
                      </p>
                    </div>
                    {comparisonSummary.correlation != null && (
                      <div>
                        <span className="text-muted-foreground">Correlation</span>
                        <p className="font-mono font-semibold mt-0.5">
                          {Number(comparisonSummary.correlation).toFixed(4)}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground w-fit">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" /> ≥99% excellent
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-amber-500" /> 95–99% good
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-orange-500" /> 90–95% moderate
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-red-500" /> &lt;90% low
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold mt-1 text-muted-foreground">Not available</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Reference score comparison was not run (no reference predictions file configured).
                  </p>
                </>
              )}
            </div>

            {modelFeaturesUsed.length > 0 && (
              <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Model Features Used</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {Number(processingReport.model_features_used_count || modelFeaturesUsed.length)} features used while scoring dev/new.
                </p>
                <div className="mt-2 max-h-36 overflow-y-auto flex flex-wrap gap-1.5">
                  {modelFeaturesUsed.map((f) => (
                    <span key={f} className="text-[10px] rounded border border-border bg-background/40 px-1.5 py-0.5 font-mono">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={() => {
                setDriftResult(null);
                setAutoRunDrift(true);
                setStep(3);
                navigate("/diagnostics");
              }}
              className="gap-2"
            >
              Proceed to Drift Diagnostics <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
