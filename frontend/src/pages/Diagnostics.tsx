import { useEffect, useMemo, useRef, useState } from "react";

import { useLocation } from "wouter";

import { motion } from "framer-motion";

import { ArrowLeft, Download } from "lucide-react";



import { AgentStepper } from "@/components/AgentStepper";

import { BenchmarkBanner } from "@/components/diagnostics/BenchmarkBanner";

import { GovernanceBanner } from "@/components/diagnostics/GovernanceBanner";

import { TabBar } from "@/components/diagnostics/TabBar";

import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";

import {

  DIAGNOSTICS_TABS,

  DIAGNOSTIC_FINAL_ACTIONS,

} from "@/config/diagnostics";

import { buildDefaultSpace, mergeDiagnosticsSearchSpace } from "@/config/recalibrationHp";

import type { FinalDecisionOptions } from "@/components/diagnostics/FinalHitlPanel";

import { usePersistedState, useSession } from "@/contexts/session";

import {

  configureRecalibration,

  normalizeOptimizationMethod,

  downloadDiagnosticsReportFile,

  runAgent,

  saveDiagnosticDecision,

} from "@/services/api";

import type { DiagnosticActionId, DiagnosticsReport } from "@/types/diagnostics";

import { ConceptDriftTab } from "./diagnostics/ConceptDriftTab";

import { DataDriftTab } from "./diagnostics/DataDriftTab";

import { PerfDriftTab } from "./diagnostics/PerfDriftTab";

import { SummaryTab } from "./diagnostics/SummaryTab";



export default function Diagnostics() {

  const [, navigate] = useLocation();

  const {

    sessionId,

    selectedModel,

    driftResult,

    setDriftResult,

    setRecalibrationResult,

    setStep,

  } = useSession();

  const [reproDone] = usePersistedState<boolean>("rcl:reproDone", false);

  const [autoRunDrift, setAutoRunDrift] = usePersistedState<boolean>("rcl:autoRunDrift", false);

  const [inventoryConfigs] = usePersistedState<Record<string, string[]>>("rcl:inventoryConfigs", {});

  const [activeTab, setActiveTab] = usePersistedState<"data" | "concept" | "performance" | "summary">(

    "rcl:diagActiveTab",

    "performance",

  );

  const [, setFinal] = usePersistedState<Record<string, unknown> | null>("rcl:diagFinal", null);



  const [running, setRunning] = useState(false);

  const [done, setDone] = useState(Boolean(driftResult));

  const [error, setError] = useState("");

  const [report, setReport] = useState<DiagnosticsReport | null>((driftResult as DiagnosticsReport | null) ?? null);

  const [downloadBusy, setDownloadBusy] = useState(false);

  const agentLaunchRef = useRef(false);

  const activeTabMeta = DIAGNOSTICS_TABS.find((t) => t.id === activeTab);

  const downloadTabId =
    activeTab === "data" || activeTab === "concept" || activeTab === "performance" ? activeTab : null;

  const handleDownloadTabReport = async () => {
    if (!sessionId || !downloadTabId || !report) return;
    try {
      setDownloadBusy(true);
      await downloadDiagnosticsReportFile(sessionId, downloadTabId, report as Record<string, unknown>);
    } finally {
      setDownloadBusy(false);
    }
  };

  const selectedModelId = selectedModel?.model_id ?? "";
  const metrics = useMemo(() => inventoryConfigs[selectedModelId] ?? [], [inventoryConfigs, selectedModelId]);

  useEffect(() => {
    if (!reproDone || !sessionId || done) return;
    if (metrics.length === 0) return;
    if (driftResult) return;
    setRunning(true);
    if (autoRunDrift) setAutoRunDrift(false);
  }, [reproDone, sessionId, done, metrics, driftResult, autoRunDrift, setAutoRunDrift]);

  useEffect(() => {
    if (!running || !sessionId || done || metrics.length === 0) return;
    if (agentLaunchRef.current) return;
    agentLaunchRef.current = true;
    setError("");
    void runAgent(sessionId, "drift", { drift_metrics: metrics }).catch((err) => {
      agentLaunchRef.current = false;
      setRunning(false);
      setError(err instanceof Error ? err.message : "Failed to start diagnostics");
    });
  }, [running, sessionId, done, metrics]);



  const handleCompleted = (result: unknown) => {

    const payload = (result as DiagnosticsReport) ?? null;

    setReport(payload);

    setDriftResult(payload as Record<string, unknown>);

    setRunning(false);

    setDone(true);

  };



  const handleFinalDecision = async (

    action: DiagnosticActionId,

    rationale: string,

    options?: FinalDecisionOptions,

  ) => {

    if (!sessionId || !selectedModel) return;

    try {

      const decision = await saveDiagnosticDecision(sessionId, "final", action, rationale);

      setFinal(decision.decision);

      const mapped = DIAGNOSTIC_FINAL_ACTIONS.find((item) => item.id === action)?.recalibrationAction ?? "no_action";

      const isOptimized = mapped === "recal_opt";

      const inventoryHpMethod = normalizeOptimizationMethod(selectedModel.optimization_method);

      const modelClass = selectedModel.model_class || "XGBoost";

      const cvFolds = options?.cvFolds ?? 5;

      const mergedSearchSpace = isOptimized

        ? mergeDiagnosticsSearchSpace(buildDefaultSpace(modelClass), options?.searchSpace)

        : undefined;

      await configureRecalibration(

        sessionId,

        [],

        modelClass,

        isOptimized ? inventoryHpMethod : "none",

        isOptimized ? cvFolds : 1,

        mergedSearchSpace,

        mapped,

      );

      setRecalibrationResult(null);

      try {
        localStorage.setItem("rcl:selectedRecommendedAction", JSON.stringify(mapped));
        if (isOptimized) {
          localStorage.setItem(
            "rcl:diagOptimizationInput",
            JSON.stringify({
              hpMethod: inventoryHpMethod,
              cvFolds,
              searchSpace: mergedSearchSpace ?? {},
            }),
          );
        }
        localStorage.removeItem("rcl:autoStartRecalibration");
      } catch {
        // Ignore storage errors; Recalibration page falls back to defaults.
      }

      setStep(4);

      navigate("/recalibration");

    } catch (err) {

      setError(err instanceof Error ? err.message : "Could not submit final decision");

    }

  };



  return (

    <div className="space-y-6 overflow-x-hidden w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16">

      <div className="flex items-center justify-between gap-4">

        <div>

        <Button

          variant="ghost"

          size="sm"

          className="text-muted-foreground mb-3 -ml-1"

          onClick={() => navigate("/post-ingestion")}

        >

          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />

          Back

        </Button>

          <h1 className="text-2xl font-bold">Diagnostics Agent</h1>

        </div>

        

      </div>



      {error && (

        <Card className="p-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30">

          <p className="text-sm text-red-700 dark:text-red-200">{error}</p>

        </Card>

      )}



      {reproDone && metrics.length === 0 && (

        <Card className="p-4 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">

          <p className="text-sm text-amber-700 dark:text-amber-200">

            No diagnostics metrics selected in Inventory configuration. Go back and select at least one metric.

          </p>

        </Card>

      )}



      {running && sessionId && !done && (
        <Card className="p-5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950">
          <h2 className="font-semibold text-sm mb-4">Diagnostics Agent</h2>
          <AgentStepper
            sessionId={sessionId}
            agent="drift"
            onCompleted={handleCompleted}
            onFailed={(msg) => {
              setRunning(false);
              agentLaunchRef.current = false;
              setError(msg || "Diagnostics failed");
            }}
          />
        </Card>
      )}



      {done && report && (

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

          <BenchmarkBanner

            datasets={(report.datasets ?? {}) as Record<string, unknown>}

          />

          <GovernanceBanner governance={report.governance} />

          <TabBar
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "data" | "concept" | "performance" | "summary")}
            items={DIAGNOSTICS_TABS}
            trailing={
              downloadTabId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs shrink-0"
                  disabled={!sessionId || downloadBusy}
                  onClick={() => void handleDownloadTabReport()}
                >
                  <Download className="h-3.5 w-3.5" />
                  {downloadBusy
                    ? "Downloading..."
                    : `Download ${activeTabMeta?.label ?? "tab"} report`}
                </Button>
              ) : null
            }
          />



          {activeTab === "data" && (

            <DataDriftTab report={report as Record<string, unknown>} selectedMetrics={metrics} />

          )}

          {activeTab === "concept" && (

            <ConceptDriftTab report={report as Record<string, unknown>} selectedMetrics={metrics} />

          )}

          {activeTab === "performance" && (

            <PerfDriftTab report={report as Record<string, unknown>} selectedMetrics={metrics} />

          )}

          {activeTab === "summary" && (

            <SummaryTab
              report={report as Record<string, unknown>}
              modelClass={selectedModel?.model_class || "XGBoost"}
              optimizationMethodLabel={normalizeOptimizationMethod(selectedModel?.optimization_method)}
              onConfirm={handleFinalDecision}
            />

          )}

        </motion.div>

      )}

    </div>

  );

}

