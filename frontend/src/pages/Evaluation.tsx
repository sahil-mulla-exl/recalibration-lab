import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Award, Target, ShieldAlert, ShieldCheck, AlertTriangle } from "lucide-react";
import { runAgent } from "@/services/api";
import { SHOW_POLICY_GUARDRAILS } from "@/config/uiVisibility";
import { usePersistedState, useSession } from "@/contexts/session";
import { ChartCard, ChartPlot, RocDiagonalReferenceLine } from "@/components/charts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { CARD_CHART_HEIGHT, CARD_CHART_HEIGHT_RADAR } from "@/lib/chartLayout";
import {
  axisTick,
  cartesianGrid,
  chartMargin,
  chartTooltipProps,
  formatChartPercent,
  formatChartValue,
  useChartTheme,
} from "@/lib/chartTheme";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentStepper } from "@/components/AgentStepper";
import {
  EvaluationMetricsTable,
  type EvaluationMetricRow,
} from "@/components/evaluation/EvaluationMetricsTable";
import { EvaluationRankOrderBreak } from "@/components/evaluation/EvaluationRankOrderBreak";
import { EvaluationXgbImportance } from "@/components/evaluation/EvaluationXgbImportance";
import type { XgboostImportancePayload } from "@/components/evaluation/EvaluationXgbImportance";
import {
  EvaluationShapImportance,
  type ShapImportancePayload,
} from "@/components/evaluation/EvaluationShapImportance";
import {
  EVALUATION_DATA_KEYS,
  EVALUATION_KS_COHORTS,
  EVALUATION_SERIES,
  evaluationKsCurvePoints,
  type EvaluationCohortKey,
} from "@/config/evaluation";
import { buildEvaluationRadarRows, type RadarChartRow } from "@/lib/evaluationRadar";
import {
  GenAiSectionInsight,
  GenAiTabSummary,
  pickGenAiInsight,
  useParsedGenAiInsight,
} from "@/components/diagnostics/GenAiInsightsPanel";
import { buildEvaluationCombinedBullets, pickEvaluationSection } from "@/lib/genaiInsightParse";
import { KsChart } from "@/components/diagnostics/KsChart";
import { toKsChartData } from "@/lib/ksCurve";
import type { ChartTheme } from "@/lib/chartTheme";
import {
  evaluationMetricVisibility,
  inventoryMetricsForModel,
  metricsSelectionKey,
  normalizeProblemType,
  performanceMetricsForProblem,
} from "@/config/inventoryMetrics";
import {
  cohortArrayFromReport,
  cohortMetricFromReport,
  cohortMetricFromReportWithFallback,
  cohortRocFromReport,
  downsampleRocPoints,
  mergeRocSeriesForChart,
} from "@/lib/evaluationReport";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line,
} from "recharts";

function EvaluationRadarTooltip({
  active,
  payload,
  theme,
}: {
  active?: boolean;
  payload?: Array<{ payload?: RadarChartRow }>;
  theme: ChartTheme;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const rows = [
    { label: EVALUATION_SERIES.championHold, raw: row.rawHold, norm: row.championHold, color: theme.series.train },
    { label: EVALUATION_SERIES.championOos, raw: row.rawOos, norm: row.championOos, color: theme.series.dev },
    { label: EVALUATION_SERIES.recalibratedOos, raw: row.rawRecal, norm: row.recalibratedOos, color: theme.series.new },
  ];

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{
        background: theme.tooltip.contentStyle.backgroundColor,
        borderColor: theme.tooltip.contentStyle.border,
        color: theme.tooltip.contentStyle.color,
      }}
    >
      <p className="font-semibold mb-1.5">{row.axis}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 tabular-nums">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
            <span className="truncate max-w-[12rem]">{r.label}</span>
          </span>
          <span>
            {row.format(r.raw)}
            <span className="text-muted-foreground ml-1">({r.norm.toFixed(0)}/100)</span>
          </span>
        </p>
      ))}
    </div>
  );
}

// ── Recommendation banner ───────────────────────────────────────────────────
function RecommendBanner({
  report,
  problemType,
}: {
  report: Record<string, unknown>;
  problemType: "classification" | "regression";
}) {
  const aucDelta = Number(report.new_auc || 0) - Number(report.orig_auc || 0);
  const rmseDelta = Number(report.orig_rmse || 0) - Number(report.new_rmse || 0);
  const deploy = problemType === "regression" ? rmseDelta > 0 : aucDelta > 0.005;
  return (
    <div className={`rounded-2xl border overflow-hidden ${deploy ? "border-emerald-500/35 bg-gradient-to-r from-emerald-500/10 to-transparent" : "border-yellow-500/30 bg-gradient-to-r from-yellow-500/8 to-transparent"}`}>
      <div className="flex items-center gap-4 p-4">
        <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${deploy ? "bg-emerald-500/20" : "bg-yellow-500/15"}`}>
          {deploy ? <Award className="h-6 w-6 text-emerald-700 dark:text-emerald-400" /> : <Target className="h-6 w-6 text-amber-700 dark:text-yellow-400" />}
        </div>
        <div className="flex-1">
          <p className={`text-base font-bold ${deploy ? "text-emerald-800 dark:text-emerald-400" : "text-amber-800 dark:text-yellow-400"}`}>
            {deploy ? "Recommend Deployment" : "Marginal Improvement — Review Carefully"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {problemType === "regression"
              ? deploy
                ? `Recalibrated RMSE improved by ${rmseDelta.toFixed(4)} with R2 ${Number(report.new_r2 || 0).toFixed(4)}.`
                : `Regression gain is marginal (RMSE Δ ${rmseDelta.toFixed(4)}). Validate on additional holdouts.`
              : deploy
                ? `Recalibrated AUC +${(aucDelta * 100).toFixed(2)} pp above champion. Top-decile overlap: ${(Number(report.top_decile_overlap ?? report.jaccard) * 100).toFixed(1)}%.`
                : `AUC improvement on ${EVALUATION_SERIES.recalibratedOos} is below threshold (${(aucDelta * 100).toFixed(2)} pp). Validate on additional holdouts.`}
          </p>
        </div>
      </div>
    </div>
  );
}

type GuardrailRule = {
  id: string;
  description: string;
  actual: string;
  threshold: string;
  severity: "critical" | "warning";
  status: "pass" | "warn" | "fail";
};

type Guardrails = {
  status: "pass" | "warn" | "block";
  failed_rules: GuardrailRule[];
  warning_rules: GuardrailRule[];
  passed_rules: GuardrailRule[];
  override_allowed: boolean;
  required_approvers: string[];
};

function PolicyGuardrailsCard({ guardrails }: { guardrails: Guardrails | null }) {
  if (!guardrails) return null;
  const statusClass =
    guardrails.status === "pass"
      ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-400"
      : guardrails.status === "warn"
        ? "border-yellow-500/25 bg-yellow-500/8 text-yellow-400"
        : "border-rose-500/25 bg-rose-500/8 text-rose-400";
  const StatusIcon = guardrails.status === "pass" ? ShieldCheck : guardrails.status === "warn" ? AlertTriangle : ShieldAlert;
  const renderRule = (rule: GuardrailRule) => (
    <div key={rule.id} className="rounded-md border border-border bg-card px-3 py-2 text-xs">
      <p className="font-medium">{rule.description}</p>
      <p className="text-muted-foreground mt-0.5">
        Actual: <span className="font-mono">{rule.actual}</span> | Threshold: <span className="font-mono">{rule.threshold}</span>
      </p>
    </div>
  );
  return (
    <Card className="p-5">
      <div className={`rounded-lg border px-3 py-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${statusClass}`}>
        <StatusIcon className="h-4 w-4" />
        Policy Guardrails: {guardrails.status}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Automatic promotion control across performance, drift stability, and governance checks.
      </p>
      {!!guardrails.failed_rules.length && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-rose-400">Blocking violations ({guardrails.failed_rules.length})</p>
          {guardrails.failed_rules.map(renderRule)}
        </div>
      )}
      {!!guardrails.warning_rules.length && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-yellow-400">Warnings ({guardrails.warning_rules.length})</p>
          {guardrails.warning_rules.map(renderRule)}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground mt-3">
        Required approvers: {guardrails.required_approvers.join(", ")}
      </p>
    </Card>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function Evaluation() {
  const [, navigate] = useLocation();
  const { sessionId, setStep, setEvaluationResult, evaluationResult, selectedModel } = useSession();
  const [inventoryConfigs] = usePersistedState<Record<string, string[]>>("rcl:inventoryConfigs", {});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(!!evaluationResult);
  const [report, setReport] = useState<Record<string, unknown> | null>(evaluationResult);
  const [error, setError] = useState("");
  const [guardrailOverride, setGuardrailOverride] = useState(false);
  const agentLaunchRef = useRef(false);
  const theme = useChartTheme();
  const problemType = normalizeProblemType(selectedModel?.problem_type || report?.problem_type);
  const selectedModelId = selectedModel?.model_id ?? "";
  const inventoryMetrics = useMemo(
    () => inventoryMetricsForModel(inventoryConfigs, selectedModelId),
    [inventoryConfigs, selectedModelId],
  );
  const performanceMetrics = useMemo(
    () => performanceMetricsForProblem(inventoryMetrics, problemType),
    [inventoryMetrics, problemType],
  );
  const visibility = useMemo(
    () => evaluationMetricVisibility(inventoryMetrics, problemType),
    [inventoryMetrics, problemType],
  );
  const metricsKey = useMemo(() => metricsSelectionKey(performanceMetrics), [performanceMetrics]);

  const launchEvaluationAgent = useCallback(async () => {
    if (!sessionId || performanceMetrics.length === 0) return;
    if (agentLaunchRef.current) return;
    agentLaunchRef.current = true;
    setError("");
    try {
      await runAgent(sessionId, "evaluation", {
        drift_metrics: inventoryMetrics,
        evaluation_metrics: inventoryMetrics,
      });
    } catch (err) {
      agentLaunchRef.current = false;
      setRunning(false);
      setError(err instanceof Error ? err.message : "Failed to start evaluation agent");
    }
  }, [sessionId, inventoryMetrics, performanceMetrics.length]);

  useEffect(() => {
    if (!sessionId) return;
    const localEval = (report?.genai_insights as Record<string, { status?: string; text?: string }> | undefined)
      ?.evaluation;
    if (localEval?.status === "ok" && localEval?.text) return;

    fetch(`/api/evaluation/report?session_id=${encodeURIComponent(sessionId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || typeof data !== "object" || "error" in data) return;
        const serverEval = (data.genai_insights as Record<string, { status?: string; text?: string }> | undefined)
          ?.evaluation;
        if (!serverEval) return;
        const shouldHydrate =
          !localEval ||
          (serverEval.status === "ok" && Boolean(serverEval.text) && localEval.status !== "ok");
        if (!shouldHydrate) return;
        setReport(data as Record<string, unknown>);
        setEvaluationResult(data as Record<string, unknown>);
        setDone(true);
      })
      .catch(() => {});
  }, [sessionId, report?.genai_insights, setEvaluationResult]);

  useEffect(() => {
    if (!report) return;
    const reportKey = metricsSelectionKey(
      ((report.selected_metrics as string[]) || []).filter((m) => performanceMetrics.includes(m as never)),
    );
    if (reportKey && reportKey !== metricsKey) {
      setReport(null);
      setEvaluationResult(null);
      setDone(false);
      agentLaunchRef.current = false;
    }
  }, [metricsKey, report, performanceMetrics, setEvaluationResult]);

  useEffect(() => {
    if (!sessionId || done || report) return;
    if (performanceMetrics.length === 0) return;
    setRunning(true);
  }, [sessionId, done, report, performanceMetrics.length]);

  useEffect(() => {
    if (!running || !sessionId || done || report || performanceMetrics.length === 0) return;
    void launchEvaluationAgent();
  }, [running, sessionId, done, report, performanceMetrics.length, launchEvaluationAgent]);

  const handleCompleted = (r: unknown) => {
    const rep = r as Record<string, unknown> | null;
    if (!rep || typeof rep !== "object") {
      agentLaunchRef.current = false;
      setRunning(false);
      setDone(false);
      setError("Evaluation finished but returned no report data.");
      return;
    }
    setError("");
    setReport(rep);
    setEvaluationResult(rep);
    setRunning(false);
    setDone(true);
  };

  const holdLift = cohortArrayFromReport<{ decile: number; lift: number }>(
    report,
    "champion_hold",
    "lift_table",
    "champion_hold_lift_table",
  );
  const championOosLift = cohortArrayFromReport<{ decile: number; lift: number }>(
    report,
    "champion_oos",
    "lift_table",
    "orig_lift_table",
  );
  const recalOosLift = cohortArrayFromReport<{ decile: number; lift: number }>(
    report,
    "recalibrated_oos",
    "lift_table",
    "new_lift_table",
  );
  const liftRows = Math.max(holdLift.length, championOosLift.length, recalOosLift.length);
  const liftData = Array.from({ length: liftRows }).map((_, i) => ({
    decile: `D${championOosLift[i]?.decile ?? holdLift[i]?.decile ?? i + 1}`,
    [EVALUATION_DATA_KEYS.championHold]: Number((holdLift[i]?.lift ?? 0).toFixed(1)),
    [EVALUATION_DATA_KEYS.championOos]: Number((championOosLift[i]?.lift ?? 0).toFixed(1)),
    [EVALUATION_DATA_KEYS.recalibratedOos]: Number((recalOosLift[i]?.lift ?? 0).toFixed(1)),
  }));

  const rocData = useMemo(() => {
    const series = [
      {
        key: EVALUATION_DATA_KEYS.championHold,
        points: downsampleRocPoints(cohortRocFromReport(report, "champion_hold", "champion_hold_roc")),
      },
      {
        key: EVALUATION_DATA_KEYS.championOos,
        points: downsampleRocPoints(cohortRocFromReport(report, "champion_oos", "orig_roc")),
      },
      {
        key: EVALUATION_DATA_KEYS.recalibratedOos,
        points: downsampleRocPoints(cohortRocFromReport(report, "recalibrated_oos", "new_roc")),
      },
    ].filter((entry) => entry.points.length > 0);
    if (!series.length) return [];
    return mergeRocSeriesForChart(series);
  }, [report]);

  const ksCohorts = useMemo(
    () =>
      EVALUATION_KS_COHORTS.map((cfg) => ({
        key: cfg.key,
        label: cfg.label,
        color: theme.series[cfg.colorKey],
        points: evaluationKsCurvePoints(report, cfg.cohort),
      })).filter((c) => c.points.length > 0),
    [report, theme.series.train, theme.series.dev, theme.series.new],
  );
  const productionKsCohorts = useMemo(
    () => ksCohorts.filter((c) => c.key !== EVALUATION_DATA_KEYS.recalibratedOos),
    [ksCohorts],
  );
  const recalKsCohort = useMemo(
    () => ksCohorts.find((c) => c.key === EVALUATION_DATA_KEYS.recalibratedOos),
    [ksCohorts],
  );
  const [productionKsKey, setProductionKsKey] = useState<string>(EVALUATION_DATA_KEYS.championHold);
  useEffect(() => {
    if (!productionKsCohorts.length) return;
    if (!productionKsCohorts.some((c) => c.key === productionKsKey)) {
      setProductionKsKey(productionKsCohorts[0].key);
    }
  }, [productionKsCohorts, productionKsKey]);
  const selectedProductionKs =
    productionKsCohorts.find((c) => c.key === productionKsKey) ?? productionKsCohorts[0];

  const xgboostImportance = (report?.xgboost_importance || null) as XgboostImportancePayload | null;
  const {
    showAuc,
    showKs,
    showGini,
    showCalibration,
    showLift,
    showRankOrderBreak,
    showFeatureImportance,
    showRmse,
    showMae,
    showR2,
    hasAny: showMetricsForProblem,
  } = visibility;
  const modelClass = String(selectedModel?.model_class ?? "");
  const isXgbModel = /xgb/i.test(modelClass);
  const showXgbNativeImportance =
    showMetricsForProblem &&
    (isXgbModel || Boolean(xgboostImportance?.available));
  const shapImportance = (report?.shap_importance || null) as ShapImportancePayload | null;
  const showShapImportance =
    showMetricsForProblem &&
    (showFeatureImportance || showXgbNativeImportance || Boolean(shapImportance?.available));
  const evalGenAi = pickGenAiInsight(report ?? undefined, "evaluation");
  const evalGenAiParsed = useParsedGenAiInsight(evalGenAi);
  const evalInsightBullets = useMemo(
    () => buildEvaluationCombinedBullets(evalGenAiParsed, 4),
    [evalGenAiParsed],
  );
  const showCombinedEvalInsight =
    evalGenAi?.status === "ok" && evalInsightBullets.length > 0;
  const evaluationMetricRows = useMemo((): EvaluationMetricRow[] => {
    if (!report) return [];
    const m = (cohort: EvaluationCohortKey, field: string, legacy?: string) =>
      cohortMetricFromReport(report, cohort, field, legacy);
    const rows: EvaluationMetricRow[] = [];

    if (problemType === "regression") {
      if (showRmse) {
        rows.push({
          metric: "RMSE",
          hold: m("champion_hold", "rmse", "champion_hold_rmse"),
          oos: m("champion_oos", "rmse", "orig_rmse"),
          recal: m("recalibrated_oos", "rmse", "new_rmse"),
          higherIsBetter: false,
        });
      }
      if (showMae) {
        rows.push({
          metric: "MAE",
          hold: m("champion_hold", "mae", "champion_hold_mae"),
          oos: m("champion_oos", "mae", "orig_mae"),
          recal: m("recalibrated_oos", "mae", "new_mae"),
          higherIsBetter: false,
        });
      }
      if (showR2) {
        rows.push({
          metric: "R²",
          hold: m("champion_hold", "r2", "champion_hold_r2"),
          oos: m("champion_oos", "r2", "orig_r2"),
          recal: m("recalibrated_oos", "r2", "new_r2"),
        });
      }
    } else {
      if (showAuc) {
        rows.push({
          metric: "AUC",
          hold: m("champion_hold", "auc", "champion_hold_auc"),
          oos: m("champion_oos", "auc", "orig_auc"),
          recal: m("recalibrated_oos", "auc", "new_auc"),
        });
        rows.push({
          metric: "AUC-PR",
          hold: m("champion_hold", "auc_pr", "champion_hold_auc_pr"),
          oos: m("champion_oos", "auc_pr", "orig_auc_pr"),
          recal: m("recalibrated_oos", "auc_pr", "new_auc_pr"),
        });
      }
      if (showKs) {
        rows.push({
          metric: "KS Statistic",
          hold: m("champion_hold", "ks", "champion_hold_ks"),
          oos: m("champion_oos", "ks", "orig_ks"),
          recal: m("recalibrated_oos", "ks", "new_ks"),
        });
      }
      if (showGini) {
        rows.push({
          metric: "Gini Coefficient",
          hold: m("champion_hold", "gini", "champion_hold_gini"),
          oos: m("champion_oos", "gini", "orig_gini"),
          recal: m("recalibrated_oos", "gini", "new_gini"),
        });
      }
      if (showCalibration) {
        rows.push({
          metric: "Calibration Error",
          hold: m("champion_hold", "cal_error", "champion_hold_cal_error"),
          oos: m("champion_oos", "cal_error", "orig_cal_error"),
          recal: m("recalibrated_oos", "cal_error", "new_cal_error"),
          higherIsBetter: false,
          format: (v) => `${v.toFixed(2)}%`,
        });
      }
      if (showLift) {
        rows.push({
          metric: "Top-Decile Lift",
          hold: m("champion_hold", "top_decile_lift", "top_decile_lift_champion_hold"),
          oos: m("champion_oos", "top_decile_lift", "top_decile_lift_orig"),
          recal: m("recalibrated_oos", "top_decile_lift", "top_decile_lift_new"),
          format: (v) => `${v.toFixed(3)}x`,
        });
      }
    }

    return rows;
  }, [
    report,
    problemType,
    showRmse,
    showMae,
    showR2,
    showAuc,
    showKs,
    showGini,
    showCalibration,
    showLift,
  ]);

  const radarData = useMemo(() => {
    if (!report || !showMetricsForProblem) return [] as RadarChartRow[];
    const m = (cohort: EvaluationCohortKey, field: string, legacy?: string) =>
      cohortMetricFromReport(report, cohort, field, legacy);
    const mAucPr = (cohort: EvaluationCohortKey, legacy?: string) =>
      cohortMetricFromReportWithFallback(report, cohort, "auc_pr", legacy, 0);
    const finite = (v: number) => Number.isFinite(v);

    const specs =
      problemType === "regression"
        ? [
            ...(showR2
              ? [{ axis: "R2", hold: m("champion_hold", "r2", "champion_hold_r2"), oos: m("champion_oos", "r2", "orig_r2"), recal: m("recalibrated_oos", "r2", "new_r2"), higherIsBetter: true as const }]
              : []),
            ...(showRmse
              ? [{ axis: "RMSE", hold: m("champion_hold", "rmse", "champion_hold_rmse"), oos: m("champion_oos", "rmse", "orig_rmse"), recal: m("recalibrated_oos", "rmse", "new_rmse"), higherIsBetter: false as const }]
              : []),
            ...(showMae
              ? [{ axis: "MAE", hold: m("champion_hold", "mae", "champion_hold_mae"), oos: m("champion_oos", "mae", "orig_mae"), recal: m("recalibrated_oos", "mae", "new_mae"), higherIsBetter: false as const }]
              : []),
          ]
        : [
            ...(showAuc
              ? [{ axis: "AUC", hold: m("champion_hold", "auc", "champion_hold_auc"), oos: m("champion_oos", "auc", "orig_auc"), recal: m("recalibrated_oos", "auc", "new_auc"), higherIsBetter: true as const, format: (v: number) => formatChartValue(v) }]
              : []),
            ...(showAuc
              ? [{
                  axis: "AUC-PR",
                  hold: mAucPr("champion_hold", "champion_hold_auc_pr"),
                  oos: mAucPr("champion_oos", "orig_auc_pr"),
                  recal: mAucPr("recalibrated_oos", "new_auc_pr"),
                  higherIsBetter: true as const,
                  format: (v: number) => formatChartValue(v),
                }]
              : []),
            ...(showKs
              ? [{ axis: "KS", hold: m("champion_hold", "ks", "champion_hold_ks"), oos: m("champion_oos", "ks", "orig_ks"), recal: m("recalibrated_oos", "ks", "new_ks"), higherIsBetter: true as const, format: (v: number) => formatChartValue(v) }]
              : []),
            ...(showGini
              ? [{ axis: "Gini", hold: m("champion_hold", "gini", "champion_hold_gini"), oos: m("champion_oos", "gini", "orig_gini"), recal: m("recalibrated_oos", "gini", "new_gini"), higherIsBetter: true as const, format: (v: number) => formatChartValue(v) }]
              : []),
            ...(showLift
              ? [{
                  axis: "Top Lift",
                  hold: m("champion_hold", "top_decile_lift", "top_decile_lift_champion_hold"),
                  oos: m("champion_oos", "top_decile_lift", "top_decile_lift_orig"),
                  recal: m("recalibrated_oos", "top_decile_lift", "top_decile_lift_new"),
                  higherIsBetter: true as const,
                  format: (v: number) => `${formatChartValue(v)}x`,
                }]
              : []),
            ...(showCalibration
              ? [{
                  axis: "Calibration",
                  hold: m("champion_hold", "cal_error", "champion_hold_cal_error"),
                  oos: m("champion_oos", "cal_error", "orig_cal_error"),
                  recal: m("recalibrated_oos", "cal_error", "new_cal_error"),
                  higherIsBetter: false as const,
                  format: (v: number) => formatChartPercent(v),
                }]
              : []),
          ];

    return buildEvaluationRadarRows(
      specs.filter(
        (s) =>
          s.axis === "AUC-PR" ||
          finite(s.hold) ||
          finite(s.oos) ||
          finite(s.recal),
      ),
    );
  }, [report, showMetricsForProblem, problemType, showAuc, showKs, showGini, showLift, showCalibration, showRmse, showMae, showR2]);

  const guardrails = (report?.policy_guardrails || null) as Guardrails | null;
  const guardrailStatus = guardrails?.status || "pass";
  const isBlocked = guardrailStatus === "block";
  const isWarnWithoutOverride = guardrailStatus === "warn" && !guardrailOverride;

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div>
        <Button variant="ghost" size="sm" className="text-muted-foreground mb-3 -ml-1" onClick={() => navigate("/recalibration")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back
        </Button>
        <h1 className="text-2xl font-bold">Model Evaluation</h1>
      </div>

      {error && (
        <Card className="p-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30">
          <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
          {sessionId && performanceMetrics.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                agentLaunchRef.current = false;
                setRunning(true);
                setDone(false);
                void launchEvaluationAgent();
              }}
            >
              Retry evaluation
            </Button>
          )}
        </Card>
      )}

      {!running && !done && performanceMetrics.length === 0 && (
        <Card className="p-4 border-orange-300 bg-orange-50 dark:border-orange-500/30 dark:bg-orange-500/5">
          <p className="text-xs text-orange-800 dark:text-orange-300">
            No performance metrics are selected for this model in Inventory. Select at least one performance metric
            (e.g. AUC, KS, Lift/Gains) and return to this page.
          </p>
        </Card>
      )}

      {running && !done && sessionId && (
        <Card className="p-5">
          <h2 className="font-semibold text-sm mb-4">Evaluation Agent</h2>
          <AgentStepper
            sessionId={sessionId}
            agent="evaluation"
            onStreamConnected={launchEvaluationAgent}
            onCompleted={handleCompleted}
            onFailed={(msg) => {
              agentLaunchRef.current = false;
              setRunning(false);
              setError(msg || "Evaluation agent failed");
            }}
          />
        </Card>
      )}

      {done && report && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

          {showCombinedEvalInsight && (
            <GenAiTabSummary
              insight={evalGenAi}
              title="AI evaluation insights"
              bullets={evalInsightBullets}
              className="mb-4"
            />
          )}
          {!evalGenAi && (
            <Card className="p-4 mb-4 border-slate-200 dark:border-slate-700">
              <p className="text-sm text-muted-foreground">
                AI insights are not on this report yet. Re-run the evaluation agent to execute the
                &quot;Generate AI evaluation insights&quot; step.
              </p>
            </Card>
          )}
          {!showCombinedEvalInsight && (
            <RecommendBanner report={report} problemType={problemType} />
          )}
          {SHOW_POLICY_GUARDRAILS && <PolicyGuardrailsCard guardrails={guardrails} />}

          {showMetricsForProblem ? (
            <EvaluationMetricsTable rows={evaluationMetricRows} />
          ) : (
            <Card className="p-4 border-orange-300 bg-orange-50 dark:border-orange-500/30 dark:bg-orange-500/5">
              <p className="text-xs text-orange-800 dark:text-orange-300">
                No performance metrics match this model&apos;s problem type in Inventory ({problemType}). Select metrics
                such as {problemType === "regression" ? "RMSE, MAE, or R²" : "AUC, KS, or Lift/Gains"} and rerun evaluation.
              </p>
            </Card>
          )}

          <div className="space-y-4">
            <div
              className={`grid grid-cols-1 ${
                problemType === "classification" &&
                showAuc &&
                rocData.length > 0 &&
                radarData.length > 0
                  ? "xl:grid-cols-2"
                  : ""
              } gap-4`}
            >
              {problemType === "classification" && showAuc && rocData.length > 0 && (
                <ChartCard
                  title="ROC Curves"
                  subtitle="Receiver Operating Characteristic — higher curve = better discrimination"
                >
                  <ChartFrame
                    theme={theme}
                    height={CARD_CHART_HEIGHT}
                    legend={[
                      { value: EVALUATION_SERIES.championHold, type: "line", color: theme.series.train, dataKey: EVALUATION_DATA_KEYS.championHold },
                      { value: EVALUATION_SERIES.championOos, type: "line", color: theme.series.dev, dataKey: EVALUATION_DATA_KEYS.championOos },
                      { value: EVALUATION_SERIES.recalibratedOos, type: "line", color: theme.series.new, dataKey: EVALUATION_DATA_KEYS.recalibratedOos },
                    ]}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={rocData} margin={chartMargin.xyTitles}>
                        <CartesianGrid {...cartesianGrid(theme)} />
                        <XAxis {...chartXAxis(theme, "False positive rate", { dataKey: "fpr", type: "number", domain: [0, 1], tickFormatter: (v) => formatChartValue(v) })} />
                        <YAxis {...chartYAxis(theme, "True positive rate", { type: "number", domain: [0, 1], tickFormatter: (v) => formatChartValue(v) })} />
                        <Tooltip formatter={(v: number) => formatChartValue(v)} {...chartTooltipProps(theme, { cursor: "line" })} />
                        <RocDiagonalReferenceLine theme={theme} />
                        <Area type="monotone" dataKey={EVALUATION_DATA_KEYS.championHold} name={EVALUATION_SERIES.championHold} stroke={theme.series.train} strokeWidth={theme.plot.lineStrokeWidth} fill={theme.series.trainFill} fillOpacity={theme.plot.areaFillOpacity} dot={false} legendType="none" connectNulls />
                        <Area type="monotone" dataKey={EVALUATION_DATA_KEYS.championOos} name={EVALUATION_SERIES.championOos} stroke={theme.series.dev} strokeWidth={theme.plot.lineStrokeWidth} fill={theme.series.devFill} fillOpacity={theme.plot.areaFillOpacity} dot={false} legendType="none" connectNulls />
                        <Area type="monotone" dataKey={EVALUATION_DATA_KEYS.recalibratedOos} name={EVALUATION_SERIES.recalibratedOos} stroke={theme.series.new} strokeWidth={theme.plot.lineStrokeWidth} fill={theme.series.newFill} fillOpacity={theme.plot.areaFillOpacity} dot={false} legendType="none" connectNulls />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartFrame>
                </ChartCard>
              )}

              {radarData.length > 0 && (
                <ChartCard
                  title="Multi-Metric Radar"
                  subtitle="Each axis scales 0–100 from the max of all three cohorts on that metric (hover for raw values)."
                >
                  <ChartFrame
                    theme={theme}
                    height={CARD_CHART_HEIGHT_RADAR}
                    legend={[
                      { value: EVALUATION_SERIES.championHold, type: "line", color: theme.series.train, dataKey: EVALUATION_DATA_KEYS.championHold },
                      { value: EVALUATION_SERIES.championOos, type: "line", color: theme.series.dev, dataKey: EVALUATION_DATA_KEYS.championOos },
                      { value: EVALUATION_SERIES.recalibratedOos, type: "line", color: theme.series.new, dataKey: EVALUATION_DATA_KEYS.recalibratedOos },
                    ]}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart
                        data={radarData}
                        margin={{ ...chartMargin.radar, top: 28, right: 36, bottom: 28, left: 36 }}
                        outerRadius="72%"
                        cx="50%"
                        cy="50%"
                      >
                        <PolarGrid stroke={theme.radar.grid} />
                        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} />
                        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} stroke={theme.axisLine} />
                        <Radar dataKey={EVALUATION_DATA_KEYS.championHold} stroke={theme.series.train} fill={theme.series.trainFill} fillOpacity={theme.plot.radarFillOpacity} strokeWidth={theme.plot.lineStrokeWidth} legendType="none" />
                        <Radar dataKey={EVALUATION_DATA_KEYS.championOos} stroke={theme.series.dev} fill={theme.series.devFill} fillOpacity={theme.plot.radarFillOpacity} strokeWidth={theme.plot.lineStrokeWidth} legendType="none" />
                        <Radar dataKey={EVALUATION_DATA_KEYS.recalibratedOos} stroke={theme.series.new} fill={theme.series.newFill} fillOpacity={theme.plot.radarFillOpacity} strokeWidth={theme.plot.lineStrokeWidth} legendType="none" />
                        <Tooltip
                          cursor={false}
                          content={(props) => (
                            <EvaluationRadarTooltip
                              active={props.active}
                              payload={props.payload as unknown as Array<{ payload?: RadarChartRow }>}
                              theme={theme}
                            />
                          )}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </ChartFrame>
                </ChartCard>
              )}
            </div>

            {problemType === "classification" && showKs && (productionKsCohorts.length > 0 || recalKsCohort) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {productionKsCohorts.length > 0 && selectedProductionKs && (
                  <ChartCard
                    title="KS Curve — Existing Model validation"
                    className="w-full"
                    actions={
                      productionKsCohorts.length > 1 ? (
                        <Select value={productionKsKey} onValueChange={setProductionKsKey}>
                          <SelectTrigger className="h-8 w-[min(100%,280px)] text-xs">
                            <SelectValue placeholder="Select cohort" />
                          </SelectTrigger>
                          <SelectContent>
                            {productionKsCohorts.map((cohort) => (
                              <SelectItem key={cohort.key} value={cohort.key} className="text-xs">
                                {cohort.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : undefined
                    }
                  >
                    <KsChart data={toKsChartData(selectedProductionKs.points)} />
                  </ChartCard>
                )}
                {recalKsCohort && (
                  <ChartCard title={`KS Curve — ${recalKsCohort.label}`} className="w-full">
                    <KsChart data={toKsChartData(recalKsCohort.points)} />
                  </ChartCard>
                )}
              </div>
            )}
            <GenAiSectionInsight text={pickEvaluationSection(evalGenAiParsed, "metrics")} className="mt-2" />
          </div>

          {problemType === "classification" && showRankOrderBreak && report && (
            <>
            <EvaluationRankOrderBreak
              report={report}
              theme={theme}
              cohortColors={{
                [EVALUATION_DATA_KEYS.championHold]: theme.series.train,
                [EVALUATION_DATA_KEYS.championOos]: theme.series.dev,
                [EVALUATION_DATA_KEYS.recalibratedOos]: theme.series.new,
              }}
            />
            <GenAiSectionInsight text={pickEvaluationSection(evalGenAiParsed, "rank")} />
            </>
          )}

          {/* Lift chart */}
          {problemType === "classification" && showLift && liftData.length > 0 && (
            <ChartCard
              title="Cumulative Lift by Decile"
              subtitle="How many more responders does each model capture vs. random?"
            >
              <ChartFrame
                theme={theme}
                height={CARD_CHART_HEIGHT}
                legend={[
                  { value: EVALUATION_SERIES.championHold, type: "square", color: theme.series.train, dataKey: EVALUATION_DATA_KEYS.championHold },
                  { value: EVALUATION_SERIES.championOos, type: "square", color: theme.series.dev, dataKey: EVALUATION_DATA_KEYS.championOos },
                  { value: EVALUATION_SERIES.recalibratedOos, type: "square", color: theme.series.new, dataKey: EVALUATION_DATA_KEYS.recalibratedOos },
                ]}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={liftData} margin={chartMargin.xyTitles} barGap={3}>
                    <CartesianGrid {...cartesianGrid(theme)} />
                    <XAxis {...chartXAxis(theme, "Score decile", { dataKey: "decile" })} />
                    <YAxis {...chartYAxis(theme, "Lift (×)", {})} />
                    <Tooltip formatter={(v: number) => `${formatChartValue(v)}x`} {...chartTooltipProps(theme)} />
                    <ReferenceLine y={1} stroke={theme.axisLine} strokeDasharray="4 4" label={{ value: "Baseline", fontSize: 9, fill: theme.axis }} />
                    <Bar dataKey={EVALUATION_DATA_KEYS.championHold} fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={theme.plot.barStrokeWidth} radius={[3, 3, 0, 0]} opacity={theme.plot.barLayerOpacity} legendType="none" />
                    <Bar dataKey={EVALUATION_DATA_KEYS.championOos} fill={theme.series.devFill} stroke={theme.series.dev} strokeWidth={theme.plot.barStrokeWidth} radius={[3, 3, 0, 0]} opacity={theme.plot.barLayerOpacity} legendType="none" />
                    <Bar dataKey={EVALUATION_DATA_KEYS.recalibratedOos} fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={theme.plot.barStrokeWidth} radius={[3, 3, 0, 0]} opacity={theme.plot.barLayerOpacity} legendType="none" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </ChartCard>
          )}
          {problemType === "classification" && showLift && liftData.length > 0 && (
            <GenAiSectionInsight text={pickEvaluationSection(evalGenAiParsed, "lift")} />
          )}

          {showXgbNativeImportance && (
            <EvaluationXgbImportance payload={xgboostImportance} />
          )}

          {showShapImportance && (
            <EvaluationShapImportance payload={shapImportance} />
          )}

          {(showXgbNativeImportance || showShapImportance) && (
            <GenAiSectionInsight text={pickEvaluationSection(evalGenAiParsed, "importance")} />
          )}

          <div className="flex justify-end">
            {SHOW_POLICY_GUARDRAILS && guardrailStatus === "warn" && (
              <Button
                type="button"
                variant={guardrailOverride ? "default" : "outline"}
                className="mr-2"
                onClick={() => setGuardrailOverride((v) => !v)}
              >
                {guardrailOverride ? "Override Enabled" : "Enable Risk Override"}
              </Button>
            )}
            <Button
              disabled={SHOW_POLICY_GUARDRAILS && (isBlocked || isWarnWithoutOverride)}
              onClick={() => { setStep(6); navigate("/export"); }}
              className="gap-2"
            >
              Proceed to Export <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          {SHOW_POLICY_GUARDRAILS && isBlocked && (
            <p className="text-xs text-rose-400 text-right">
              Export promotion is blocked by critical guardrail violations. Resolve failed rules before proceeding.
            </p>
          )}
          {SHOW_POLICY_GUARDRAILS && isWarnWithoutOverride && (
            <p className="text-xs text-yellow-400 text-right">
              Guardrail warnings detected. Enable override to proceed with explicit risk acceptance.
            </p>
          )}
        </motion.div>
      )}
    </div>
  );
}
