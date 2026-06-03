import { useMemo, useState } from "react";
import {
  metricsAtThreshold,
  THRESHOLD_METRIC_ROWS,
  type ThresholdMode,
} from "@/lib/classificationMetrics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalibrationChart } from "@/components/diagnostics/CalibrationChart";
import { ChartCard } from "@/components/diagnostics/ChartCard";
import { DecileChart } from "@/components/diagnostics/DecileChart";
import { KsChart } from "@/components/diagnostics/KsChart";
import { PdpChart } from "@/components/diagnostics/PdpChart";
import { RadarPerfChart } from "@/components/diagnostics/RadarPerfChart";
import { RocChart } from "@/components/diagnostics/RocChart";
import { ShapFlagCards } from "@/components/diagnostics/ShapFlagCards";
import { ShapImportanceChart } from "@/components/diagnostics/ShapImportanceChart";
import { ShapImportanceTable } from "@/components/diagnostics/ShapImportanceTable";
import { DiagnosticsSectionHeading } from "@/components/diagnostics/DiagnosticsSectionHeading";
import { PERFORMANCE_DRIFT_SECTIONS } from "@/config/diagnostics";
import {
  INGESTION_DATASETS,
  perfBaselineLabel,
  perfBaselineShortLabel,
  perfCompareSubtitle,
  perfDeltaShortLabel,
  perfNewLabel,
  perfNewShortLabel,
} from "@/config/datasets";
import { normalizeProblemType, perfDriftVisibility } from "@/config/inventoryMetrics";
import { Card } from "@/components/ui/card";

type PerfDriftTabProps = {
  report: Record<string, unknown>;
  selectedMetrics?: string[];
};

type ConfMatrix = { tn: number; fp: number; fn: number; tp: number };

function ConfusionMatrixCard({
  title,
  matrix,
  precision,
  recall,
  f1,
  accuracy,
}: {
  title: string;
  matrix: ConfMatrix;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}) {
  const total = matrix.tn + matrix.fp + matrix.fn + matrix.tp;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  const Cell = ({
    value,
    label,
    tone,
  }: {
    value: number;
    label: string;
    tone: "good" | "warn" | "primary";
  }) => {
    const cls =
      tone === "good"
        ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-200"
        : tone === "primary"
          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-200"
          : "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-200";
    return (
      <div className={`rounded-lg p-3 text-center ${cls}`}>
        <div className="text-lg font-extrabold">{value.toLocaleString()}</div>
        <div className="text-[10px] text-muted-foreground mt-1">{pct(value).toFixed(1)}%</div>
        <div className="text-[10px] text-muted-foreground mt-1">{label}</div>
      </div>
    );
  };

  return (
    <ChartCard title={title}>
      <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground mb-2">
        <div className="text-center uppercase">Pred 0</div>
        <div className="text-center uppercase">Pred 1</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Cell value={matrix.tn} label="True negatives" tone="good" />
        <Cell value={matrix.fp} label="False positives" tone="warn" />
        <Cell value={matrix.fn} label="False negatives" tone="warn" />
        <Cell value={matrix.tp} label="True positives" tone="primary" />
      </div>
      <div className="text-xs text-muted-foreground mt-3">
        Precision {precision.toFixed(3)} · Recall {recall.toFixed(3)} · F1 {f1.toFixed(3)} · Accuracy {accuracy.toFixed(3)}
      </div>
    </ChartCard>
  );
}

export function PerfDriftTab({ report, selectedMetrics = [] }: PerfDriftTabProps) {
  const perfForThreshold = (report.performance_drift ?? {}) as Record<string, unknown>;
  const [thresholdMode, setThresholdMode] = useState<ThresholdMode>("current");
  const [manualThreshold, setManualThreshold] = useState(
    () => Number(perfForThreshold.classification_threshold ?? 0.3),
  );
  const [pdpFeature, setPdpFeature] = useState<string>("");
  const perf = (report.performance_drift ?? {}) as Record<string, any>;
  const interp = (report.interpretability ?? {}) as Record<string, any>;
  const problemType = normalizeProblemType(report.problem_type);
  const inventorySelection =
    selectedMetrics.length > 0
      ? selectedMetrics
      : ((report.selected_metrics as string[]) ?? []);
  const vis = perfDriftVisibility(inventorySelection, problemType);

  const radarRows = [
    vis.showAuc ? { metric: "AUC", dev: Number(perf.auc_dev ?? 0), current: Number(perf.auc_new ?? 0) } : null,
    vis.showKs ? { metric: "KS", dev: Number(perf.ks_dev ?? 0), current: Number(perf.ks_new ?? 0) } : null,
    vis.showGini ? { metric: "Gini", dev: Number(perf.gini_dev ?? 0), current: Number(perf.gini_new ?? 0) } : null,
    vis.showAuc
      ? { metric: "AUC-PR", dev: Number(perf.auc_pr_dev ?? 0), current: Number(perf.auc_pr_new ?? 0) }
      : null,
  ].filter((row): row is { metric: string; dev: number; current: number } => row != null);

  if (!vis.hasAny) {
    return (
      <Card className="p-4 border-orange-300 bg-orange-50 dark:border-orange-500/30 dark:bg-orange-500/5">
        <p className="text-xs text-orange-800 dark:text-orange-300">
          No performance metrics are selected in Inventory for this model. Select metrics on the Inventory page and
          rerun diagnostics.
        </p>
      </Card>
    );
  }

  if (problemType === "regression") {
    const fmt = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toFixed(4) : "—");
  return (
      <div className="space-y-4">
        <DiagnosticsSectionHeading title={PERFORMANCE_DRIFT_SECTIONS[1].label} subtitle="Regression performance on validation cohorts" />
        <ChartCard title="Regression metrics">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">{perfBaselineShortLabel()}</TableHead>
                <TableHead className="text-right">{perfNewShortLabel()}</TableHead>
                <TableHead className="text-right">{perfDeltaShortLabel()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vis.showRmse && (
                <TableRow>
                  <TableCell className="font-medium">RMSE</TableCell>
                  <TableCell className="text-right font-mono">{fmt(perf.rmse_dev)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(perf.rmse_new)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {fmt(Number(perf.rmse_new) - Number(perf.rmse_dev))}
                  </TableCell>
                </TableRow>
              )}
              {vis.showMae && (
                <TableRow>
                  <TableCell className="font-medium">MAE</TableCell>
                  <TableCell className="text-right font-mono">{fmt(perf.mae_dev)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(perf.mae_new)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {fmt(Number(perf.mae_new) - Number(perf.mae_dev))}
                  </TableCell>
                </TableRow>
              )}
              {vis.showR2 && (
                <TableRow>
                  <TableCell className="font-medium">R²</TableCell>
                  <TableCell className="text-right font-mono">{fmt(perf.r2_dev)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(perf.r2_new)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {fmt(Number(perf.r2_new) - Number(perf.r2_dev))}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ChartCard>
      </div>
    );
  }
  const thresholds = (perf.thresholds ?? {}) as { ks_optimal?: number; f1_optimal?: number };

  const decileData = useMemo(() => {
    const dev = (perf.decile_rates_dev ?? []) as number[];
    const current = (perf.decile_rates_new ?? []) as number[];
    return Array.from({ length: Math.max(dev.length, current.length) }).map((_, idx) => ({
      decile: `D${idx + 1}`,
      dev: Number(dev[idx] ?? 0),
      current: Number(current[idx] ?? 0),
    }));
  }, [perf]);
  const classificationAtThreshold = useMemo(
    () => metricsAtThreshold(perf, thresholdMode, manualThreshold),
    [perf, thresholdMode, manualThreshold],
  );
  const selectedThreshold = classificationAtThreshold.threshold;
  const devClf = classificationAtThreshold.dev;
  const newClf = classificationAtThreshold.new;
  const shapDev = (interp.shap_importance_dev ?? {}) as Record<string, number>;
  const shapNew = (interp.shap_importance_new ?? {}) as Record<string, number>;
  const shapRowsAll = useMemo(() => {
    const keys = Array.from(new Set([...Object.keys(shapDev), ...Object.keys(shapNew)]));
    const sortedDev = [...keys].sort((a, b) => (Number(shapDev[b] ?? 0) - Number(shapDev[a] ?? 0)));
    const rankDev = Object.fromEntries(sortedDev.map((k, idx) => [k, idx + 1]));
    const sortedNew = [...keys].sort((a, b) => (Number(shapNew[b] ?? 0) - Number(shapNew[a] ?? 0)));
    const rankNew = Object.fromEntries(sortedNew.map((k, idx) => [k, idx + 1]));
    return keys
      .map((feature) => ({
        feature,
        devRank: Number(rankDev[feature] ?? 999),
        newRank: Number(rankNew[feature] ?? 999),
        devImportance: Number(shapDev[feature] ?? 0),
        newImportance: Number(shapNew[feature] ?? 0),
      }))
      .sort((a, b) => a.devRank - b.devRank);
  }, [shapDev, shapNew]);
  const [shapSortBy, setShapSortBy] = useState<"dev" | "new">("dev");
  const [shapTopN, setShapTopN] = useState<number>(10);
  const shapRowsSorted = useMemo(() => {
    const key = shapSortBy === "dev" ? "devImportance" : "newImportance";
    return [...shapRowsAll].sort(
      (a, b) => Number(b[key as keyof typeof b] ?? 0) - Number(a[key as keyof typeof a] ?? 0),
    );
  }, [shapRowsAll, shapSortBy]);
  const shapRows = shapRowsSorted.slice(0, shapTopN === 9999 ? shapRowsSorted.length : shapTopN);
  const interpStatus = String(interp.status ?? "");
  const interpReason = String(interp.reason ?? "SHAP importance could not be computed.");
  const hasShapData = shapRowsAll.length > 0;
  const showInterpretability =
    vis.showInterpretabilityBlock || interpStatus === "ok" || hasShapData;
  const pdpDev = (interp.pdp_dev ?? {}) as Record<string, { x: number[]; y: number[] }>;
  const pdpNew = (interp.pdp_new ?? {}) as Record<string, { x: number[]; y: number[] }>;
  const pdpFeatureOptions = useMemo(() => Array.from(new Set([...Object.keys(pdpDev), ...Object.keys(pdpNew)])), [pdpDev, pdpNew]);
  const selectedPdpFeature = pdpFeature || pdpFeatureOptions[0] || "";
  const pdpDevPoints = ((pdpDev[selectedPdpFeature]?.x ?? []) as number[]).map((x, idx) => ({
    x: Number(x),
    y: Number(pdpDev[selectedPdpFeature]?.y?.[idx] ?? 0),
  }));
  const pdpNewPoints = ((pdpNew[selectedPdpFeature]?.x ?? []) as number[]).map((x, idx) => ({
    x: Number(x),
    y: Number(pdpNew[selectedPdpFeature]?.y?.[idx] ?? 0),
  }));
  const devMatrix: ConfMatrix = {
    tn: Number(devClf.tn ?? 0),
    fp: Number(devClf.fp ?? 0),
    fn: Number(devClf.fn ?? 0),
    tp: Number(devClf.tp ?? 0),
  };
  const newMatrix: ConfMatrix = {
    tn: Number(newClf.tn ?? 0),
    fp: Number(newClf.fp ?? 0),
    fn: Number(newClf.fn ?? 0),
    tp: Number(newClf.tp ?? 0),
  };
  const calibrationData = useMemo(() => {
    const dev = (perf.calibration_dev ?? []) as Array<{ decile: number; observed: number; expected: number }>;
    const cur = (perf.calibration_new ?? []) as Array<{ decile: number; observed: number; expected: number }>;
    const len = Math.max(dev.length, cur.length);
    return Array.from({ length: len }).map((_, i) => ({
      x: Number(dev[i]?.decile ?? cur[i]?.decile ?? i + 1),
      dev: Number(dev[i]?.observed ?? 0),
      current: Number(cur[i]?.observed ?? 0),
    }));
  }, [perf]);

  const scorePsi = Number(perf.score_psi?.psi ?? 0);
  const psiConclusion =
    scorePsi >= 0.25 ? "Score PSI — large drift" : scorePsi >= 0.1 ? "Score PSI — medium drift" : "Score PSI — stable";
  const pdpFeatureTypes = (interp.pdp_feature_types ?? {}) as Record<string, string>;
  const pdpChartType = pdpFeatureTypes[selectedPdpFeature] === "categorical" ? "bar" : "line";

  return (
    <div className="space-y-4">
      {vis.showClassificationBlock && (
      <div className="space-y-4">
          <DiagnosticsSectionHeading title={PERFORMANCE_DRIFT_SECTIONS[0].label} />
          <ChartCard title="Probability threshold">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span>Threshold:</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                className={`h-8 w-24 rounded border px-2 bg-background text-center font-mono ${
                  thresholdMode === "manual" ? "border-primary ring-1 ring-primary/30" : ""
                }`}
                value={manualThreshold}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setManualThreshold(Math.min(1, Math.max(0, v)));
                  setThresholdMode("manual");
                }}
              />
              <button
                type="button"
                className={`px-2 py-1 rounded text-xs border ${thresholdMode === "manual" ? "bg-secondary" : ""}`}
                onClick={() => setThresholdMode("manual")}
              >
                Manual
              </button>
              <button type="button" className={`px-2 py-1 rounded text-xs border ${thresholdMode === "ks" ? "bg-secondary" : ""}`} onClick={() => { setThresholdMode("ks"); setManualThreshold(Number(thresholds.ks_optimal ?? manualThreshold)); }}>
                KS-optimal {Number(thresholds.ks_optimal ?? 0).toFixed(3)}
              </button>
              <button type="button" className={`px-2 py-1 rounded text-xs border ${thresholdMode === "f1" ? "bg-secondary" : ""}`} onClick={() => { setThresholdMode("f1"); setManualThreshold(Number(thresholds.f1_optimal ?? manualThreshold)); }}>
                F1-optimal {Number(thresholds.f1_optimal ?? 0).toFixed(3)}
              </button>
              <button type="button" className={`px-2 py-1 rounded text-xs border ${thresholdMode === "current" ? "bg-secondary" : ""}`} onClick={() => { setThresholdMode("current"); setManualThreshold(Number(perf.classification_threshold ?? 0.3)); }}>
                Current {Number(perf.classification_threshold ?? 0).toFixed(3)}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Active threshold: {selectedThreshold.toFixed(3)}
              {thresholdMode === "manual" ? " (manual entry, metrics from nearest 0.05 grid)" : ""}
            </p>
          </ChartCard>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
            <ConfusionMatrixCard
              title={`${perfBaselineLabel()} confusion matrix`}
              matrix={devMatrix}
              precision={Number(devClf.precision ?? 0)}
              recall={Number(devClf.recall ?? 0)}
              f1={Number(devClf.f1 ?? 0)}
              accuracy={Number(devClf.accuracy ?? 0)}
            />
            <ConfusionMatrixCard
              title={`${perfNewLabel()} confusion matrix`}
              matrix={newMatrix}
              precision={Number(newClf.precision ?? 0)}
              recall={Number(newClf.recall ?? 0)}
              f1={Number(newClf.f1 ?? 0)}
              accuracy={Number(newClf.accuracy ?? 0)}
            />
          </div>
          <ChartCard
            title="Threshold metrics"
            subtitle={`At threshold ${selectedThreshold.toFixed(3)}`}
            conclusion={
              Number(newClf.f1 ?? 0) >= Number(devClf.f1 ?? 0)
                ? `Classification stable vs ${perfBaselineLabel()}`
                : `Classification degraded vs ${perfBaselineLabel()}`
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">{perfBaselineShortLabel()}</TableHead>
                  <TableHead className="text-right">{perfNewShortLabel()}</TableHead>
                  <TableHead className="text-right">{perfDeltaShortLabel()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {THRESHOLD_METRIC_ROWS.map(({ key, label }) => {
                  const dev = Number(devClf[key] ?? 0);
                  const cur = Number(newClf[key] ?? 0);
                  const delta = cur - dev;
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="text-right font-mono">{dev.toFixed(3)}</TableCell>
                      <TableCell className="text-right font-mono">{cur.toFixed(3)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(3)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ChartCard>
      </div>
      )}

      {vis.showDiscriminationBlock && (
      <div className="space-y-4">
          <DiagnosticsSectionHeading title={PERFORMANCE_DRIFT_SECTIONS[1].label} subtitle="ROC, KS, Gini, calibration, and score stability" />
          {vis.showScorePsi && (
          <ChartCard title="Score PSI" subtitle={perfCompareSubtitle()} conclusion={psiConclusion} className="w-full md:w-1/2">
            <div className="text-3xl font-semibold text-foreground">{scorePsi.toFixed(3)}</div>
          </ChartCard>
          )}
          <div className="space-y-4 min-w-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
              {vis.showRoc && (
                <ChartCard title="ROC Curve">
                  <RocChart
                    dev={(perf.roc_curve_dev ?? []) as Array<{ fpr: number; tpr: number }>}
                    current={(perf.roc_curve_new ?? []) as Array<{ fpr: number; tpr: number }>}
                  />
                </ChartCard>
              )}
              {radarRows.length > 0 && (
                <ChartCard title="Performance radar">
                  <RadarPerfChart data={radarRows} />
                </ChartCard>
              )}
            </div>
            {vis.showKsCurve && (
              <ChartCard title="KS Curve" className="w-full">
                <KsChart
                  data={
                    (perf.ks_curve_new ?? []) as Array<{
                      population_pct: number;
                      cum_pos_pct: number;
                      cum_neg_pct: number;
                    }>
                  }
                />
              </ChartCard>
            )}
            {vis.showCalibrationChart && (
              <ChartCard title="Calibration" className="w-full md:max-w-xl">
                <CalibrationChart data={calibrationData} />
              </ChartCard>
            )}
          </div>
      </div>
      )}

      {vis.showRankOrderBlock && (
      <div className="space-y-4">
          <DiagnosticsSectionHeading title={PERFORMANCE_DRIFT_SECTIONS[2].label} subtitle="Decile stability, lift, and rank-order checks" />
          {vis.showDecileLift && (
          <ChartCard title="Decile event rates" className="w-full">
            <DecileChart data={decileData} />
          </ChartCard>
          )}
      </div>
      )}

      {showInterpretability && (
      <div className="space-y-4">
          <DiagnosticsSectionHeading title={PERFORMANCE_DRIFT_SECTIONS[3].label} subtitle="SHAP shift and partial dependence" />
          <ChartCard
            title="SHAP feature importance"
            subtitle="Importance and rank shift between validation cohorts"
            actions={hasShapData ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Sort by</span>
                <select
                  className="h-8 rounded border px-2 bg-background"
                  value={shapSortBy}
                  onChange={(e) => setShapSortBy(e.target.value as "dev" | "new")}
                >
                  <option value="dev">{INGESTION_DATASETS.hold_data.label.replace(/ Sample$/, "")} importance</option>
                  <option value="new">{INGESTION_DATASETS.new_data_oos.label.replace(/ Sample$/, "")} importance</option>
                </select>
                <span className="text-muted-foreground">Top</span>
                <select
                  className="h-8 rounded border px-2 bg-background"
                  value={String(shapTopN)}
                  onChange={(e) => setShapTopN(Number(e.target.value))}
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="9999">All</option>
                </select>
              </div>
            ) : undefined}
          >
          {interpStatus === "unavailable" && !hasShapData ? (
            <p className="text-sm text-muted-foreground py-2">{interpReason}</p>
          ) : (
            <>
              <ShapFlagCards flags={interp.shap_flags as Record<string, unknown>} />
              <div className="mt-3 space-y-4">
                <ShapImportanceTable rows={shapRows} rankView="delta" />
                <ShapImportanceChart rows={shapRows} />
              </div>
            </>
          )}
          </ChartCard>
          {(vis.showFeatureImportance || pdpFeatureOptions.length > 0) && (
          <ChartCard
            title="Partial dependence (PDP)"
            subtitle={`Select any feature to compare ${perfCompareSubtitle()} PDP`}
            actions={(
              <select
                className="h-8 rounded border px-2 bg-background text-xs"
                value={selectedPdpFeature}
                onChange={(e) => setPdpFeature(e.target.value)}
              >
                {pdpFeatureOptions.map((feature) => (
                  <option key={feature} value={feature}>
                    {feature}
                  </option>
                ))}
              </select>
            )}
          >
            <PdpChart dev={pdpDevPoints} current={pdpNewPoints} chartType={pdpChartType} />
          </ChartCard>
          )}
      </div>
      )}
    </div>
  );
}
