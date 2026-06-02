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
import { CumulativeGainsChart } from "@/components/diagnostics/CumulativeGainsChart";
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
import { perfBaselineLabel, perfCompareSubtitle, perfNewLabel } from "@/config/datasets";

type PerfDriftTabProps = {
  report: Record<string, unknown>;
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

export function PerfDriftTab({ report }: PerfDriftTabProps) {
  const [thresholdMode, setThresholdMode] = useState<ThresholdMode>("current");
  const [pdpFeature, setPdpFeature] = useState<string>("");
  const perf = (report.performance_drift ?? {}) as Record<string, any>;
  const interp = (report.interpretability ?? {}) as Record<string, any>;
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
    () => metricsAtThreshold(perf, thresholdMode),
    [perf, thresholdMode],
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
  const shapRows = shapRowsAll.slice(0, 10);
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
      <div className="space-y-4">
          <DiagnosticsSectionHeading title={PERFORMANCE_DRIFT_SECTIONS[0].label} />
          <ChartCard title="Probability threshold">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span>Threshold:</span>
              <input
                readOnly
                className="h-8 w-20 rounded border px-2 bg-background text-center"
                value={selectedThreshold.toFixed(3)}
              />
              <button type="button" className={`px-2 py-1 rounded text-xs border ${thresholdMode === "ks" ? "bg-secondary" : ""}`} onClick={() => setThresholdMode("ks")}>
                KS-optimal {Number(thresholds.ks_optimal ?? 0).toFixed(3)}
              </button>
              <button type="button" className={`px-2 py-1 rounded text-xs border ${thresholdMode === "f1" ? "bg-secondary" : ""}`} onClick={() => setThresholdMode("f1")}>
                F1-optimal {Number(thresholds.f1_optimal ?? 0).toFixed(3)}
              </button>
              <button type="button" className={`px-2 py-1 rounded text-xs border ${thresholdMode === "current" ? "bg-secondary" : ""}`} onClick={() => setThresholdMode("current")}>
                Current {Number(perf.classification_threshold ?? 0).toFixed(3)}
              </button>
            </div>
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
                  <TableHead className="text-right">{perfBaselineLabel()}</TableHead>
                  <TableHead className="text-right">{perfNewLabel()}</TableHead>
                  <TableHead className="text-right">Δ ({perfNewLabel()} − {perfBaselineLabel()})</TableHead>
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

      <div className="space-y-4">
          <DiagnosticsSectionHeading title={PERFORMANCE_DRIFT_SECTIONS[1].label} subtitle="ROC, KS, Gini, calibration, and score stability" />
          <ChartCard title="Score PSI" subtitle={perfCompareSubtitle()} conclusion={psiConclusion} className="w-full md:w-1/2">
            <div className="text-3xl font-semibold text-foreground">{scorePsi.toFixed(3)}</div>
          </ChartCard>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
            <ChartCard title="ROC Curve">
            <RocChart
              dev={(perf.roc_curve_dev ?? []) as Array<{ fpr: number; tpr: number }>}
              current={(perf.roc_curve_new ?? []) as Array<{ fpr: number; tpr: number }>}
            />
            </ChartCard>
            <ChartCard title="KS Curve">
            <KsChart data={(perf.ks_curve_new ?? []) as Array<{ population_pct: number; cum_pos_pct: number; cum_neg_pct: number }>} />
            </ChartCard>
            <ChartCard title="Performance radar">
            <RadarPerfChart
              data={[
                { metric: "AUC", dev: Number(perf.auc_dev ?? 0), current: Number(perf.auc_new ?? 0) },
                { metric: "KS", dev: Number(perf.ks_dev ?? 0), current: Number(perf.ks_new ?? 0) },
                { metric: "Gini", dev: Number(perf.gini_dev ?? 0), current: Number(perf.gini_new ?? 0) },
                { metric: "AUC-PR", dev: Number(perf.auc_pr_dev ?? 0), current: Number(perf.auc_pr_new ?? 0) },
              ]}
            />
            </ChartCard>
            <ChartCard title="Calibration">
            <CalibrationChart data={calibrationData} />
            </ChartCard>
          </div>

          <ChartCard title="ROB monotonicity score" className="w-full md:w-1/2">
            <div className="space-y-2 py-1 text-left">
              <p className="text-lg font-semibold text-foreground">
                {Number(perf.rob_dev?.non_decreasing_count ?? 0)} / {Number(perf.rob_dev?.total_transitions ?? 0)} ({perfBaselineLabel()})
              </p>
              <p className="text-lg font-semibold text-foreground">
                {Number(perf.rob_new?.non_decreasing_count ?? 0)} / {Number(perf.rob_new?.total_transitions ?? 0)} ({perfNewLabel()})
              </p>
            </div>
          </ChartCard>

          <DiagnosticsSectionHeading title={PERFORMANCE_DRIFT_SECTIONS[2].label} subtitle="Decile stability, lift, and rank-order checks" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
            <ChartCard title="Decile event rates">
            <DecileChart data={decileData} />
            </ChartCard>
            <ChartCard title="Cumulative gains">
            <CumulativeGainsChart
              data={((perf.new_lift_table ?? []) as Array<{ decile: number; cumulative_capture: number }>).map((row, idx) => ({
                x: (idx + 1) * 10,
                dev: Number(((perf.dev_lift_table ?? [])[idx] as any)?.cumulative_capture ?? 0) * 100,
                current: Number(row.cumulative_capture ?? 0) * 100,
              }))}
            />
            </ChartCard>
          </div>

          <DiagnosticsSectionHeading title={PERFORMANCE_DRIFT_SECTIONS[3].label} subtitle="SHAP shift and partial dependence" />
          <ChartCard
            title="SHAP feature importance"
            subtitle="Top 10 features by development validation rank — importance and rank shift vs new validation"
          >
          <ShapFlagCards flags={interp.shap_flags as Record<string, unknown>} />
            <div className="mt-3 space-y-4">
              <ShapImportanceTable rows={shapRows} rankView="delta" />
              <ShapImportanceChart rows={shapRows} />
            </div>
          </ChartCard>
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
      </div>
    </div>
  );
}
