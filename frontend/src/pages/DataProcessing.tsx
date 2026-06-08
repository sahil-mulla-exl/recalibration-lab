import { useEffect, useRef } from "react";

import { useLocation } from "wouter";

import { motion } from "framer-motion";

import { ArrowLeft, ArrowRight, Download } from "lucide-react";

import { INGESTION_DATASETS } from "@/config/datasets";

import { exportProcessingWorkbook, runAgent } from "@/services/api";

import { usePersistedState, useSession } from "@/contexts/session";

import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";

import { AgentStepper } from "@/components/AgentStepper";
import { ScoreMatchCard } from "@/components/data-processing/ScoreMatchCard";



export default function DataProcessing() {

  const [, navigate] = useLocation();

  const { sessionId, setStep, setDriftResult, selectedModel } = useSession();

  const [reproDone, setReproDone] = usePersistedState<boolean>("rcl:reproDone", false);

  const [dataProcessingResult, setDataProcessingResult] = usePersistedState<Record<string, unknown> | null>(

    "rcl:dataProcessingResult",

    null,

  );

  const [, setAutoRunDrift] = usePersistedState<boolean>("rcl:autoRunDrift", false);

  const [loadedFiles] = usePersistedState<Record<string, { feature_count?: number; target_rate?: number }>>("rcl:loadedFiles", {});

  const agentLaunchRef = useRef(false);

  const [targetVariable] = usePersistedState<string>("rcl:targetVariable", "");

  const [outcomeVariable] = usePersistedState<string>("rcl:outcomeVariable", "");



  useEffect(() => {

    if (!sessionId || reproDone) return;

    if (agentLaunchRef.current) return;

    agentLaunchRef.current = true;

    void runAgent(sessionId, "reproducibility", {

      target_variable: targetVariable,

      outcome_variable: outcomeVariable,

    }).catch(() => {

      agentLaunchRef.current = false;

    });

  }, [sessionId, reproDone, targetVariable, outcomeVariable]);



  const processingReport = dataProcessingResult || {};

  const comparisonSummary = (processingReport.score_comparison_summary || {}) as Record<string, unknown>;

  const rowsCompared = Number(comparisonSummary.rows_compared ?? 0);

  const pctMatchStrict = comparisonSummary.pct_within_0_01 != null ? Number(comparisonSummary.pct_within_0_01) : null;

  const pctMatchRelaxed = comparisonSummary.pct_within_0_05 != null ? Number(comparisonSummary.pct_within_0_05) : null;

  const featuresUsedCount = Number(

    processingReport.model_features_used_count ||

      ((processingReport.model_features_used as string[]) || []).length,

  );

  const modelObjectFeatureCount = Number(loadedFiles.model?.feature_count ?? featuresUsedCount);

  const problemType = String(processingReport.problem_type || selectedModel?.problem_type || "classification")
    .toLowerCase()
    .startsWith("reg")
    ? "regression"
    : "classification";

  const ingestionDevTargetRate = loadedFiles.dev_data?.target_rate;
  const processedDevTargetRate =
    problemType === "regression"
      ? processingReport.dev_target_mean
      : processingReport.dev_target_rate;
  const formatTargetRate = (value: unknown) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "—";
    return problemType === "regression" ? num.toFixed(4) : `${(num * 100).toFixed(1)}%`;
  };



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

              }}

              onFailed={() => {

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

          <Card className="p-5 space-y-5">

            <div className="flex flex-wrap items-center justify-between gap-3">

              <h3 className="font-semibold text-sm">Data Processing Outcomes</h3>

              {sessionId && (

                <Button variant="outline" size="sm" className="h-8 gap-1.5" asChild>

                  <a href={exportProcessingWorkbook(sessionId, "dev")} download>

                    <Download className="h-3.5 w-3.5" />

                    Download .xlsx

                  </a>

                </Button>

              )}

            </div>



            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">

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

                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Model object features</p>

                <p className="font-mono font-semibold mt-1">{modelObjectFeatureCount.toLocaleString()}</p>

              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3">

                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{INGESTION_DATASETS.dev_data.label} mean score</p>

                <p className="font-mono font-semibold mt-1">{Number(processingReport.dev_score_mean || 0).toFixed(4)}</p>

              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3">

                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{INGESTION_DATASETS.new_data.label} mean score</p>

                <p className="font-mono font-semibold mt-1">{Number(processingReport.new_score_mean || 0).toFixed(4)}</p>

              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3">

                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {INGESTION_DATASETS.dev_data.label} {problemType === "regression" ? "target mean (upload)" : "target rate (upload)"}
                </p>

                <p className="font-mono font-semibold mt-1">{formatTargetRate(ingestionDevTargetRate)}</p>

              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3">

                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {INGESTION_DATASETS.dev_data.label} {problemType === "regression" ? "target mean (processed)" : "target rate (processed)"}
                </p>

                <p className="font-mono font-semibold mt-1">{formatTargetRate(processedDevTargetRate)}</p>

              </div>

            </div>

            <ScoreMatchCard
              rowsCompared={rowsCompared}
              pctStrict={pctMatchStrict}
              pctRelaxed={pctMatchRelaxed}
            />

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">

              {String(processingReport.new_outcome_source || "") === "observed" ? (

                <>

                  <p className="font-medium text-primary">

                    {INGESTION_DATASETS.new_data.label} outcome variable (from upload):{" "}

                    <span className="font-mono">{String(processingReport.new_outcome_column || outcomeVariable || "—")}</span>

                  </p>

                  <p className="text-muted-foreground mt-1">

                    {problemType === "regression"

                      ? `Observed outcome mean: ${Number(processingReport.new_outcome_mean ?? 0).toFixed(4)}`

                      : `Observed positive rate: ${((Number(processingReport.new_outcome_rate ?? 0)) * 100).toFixed(1)}%`}

                  </p>

                </>

              ) : (

                <>

                  <p className="font-medium text-primary">New data has no outcome column in upload</p>

                  <p className="text-muted-foreground mt-1">

                    Selected dev prediction column: <span className="font-mono">{outcomeVariable || "—"}</span>.

                    Model-generated column: <span className="font-mono">predicted_outcome</span>.

                  </p>

                </>

              )}

            </div>



            <p className="text-xs text-muted-foreground">

              Score comparison and model feature lists are available in the downloaded workbook (two sheets).

            </p>

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

