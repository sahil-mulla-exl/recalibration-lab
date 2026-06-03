import { useMemo, useState } from "react";
import { CategoricalDriftRow } from "@/components/diagnostics/CategoricalDriftRow";
import { ChartCard } from "@/components/diagnostics/ChartCard";
import { CsiRankedChart } from "@/components/diagnostics/CsiRankedChart";
import { DistributionExplorerCharts } from "@/components/diagnostics/DistributionExplorerCharts";
import { MissingRateTable } from "@/components/diagnostics/MissingRateTable";
import { useSession } from "@/contexts/session";
import { downloadDiagnosticsReportFile } from "@/services/api";
import { DescriptiveStatsCard } from "@/components/data-processing/DescriptiveStatsCard";
import { TargetEventRateChart } from "@/components/diagnostics/TargetEventRateChart";
import { driftBaselineLabel, driftCompareSubtitle } from "@/config/datasets";
import { hasInventoryMetric, INVENTORY_DATA_DRIFT } from "@/config/inventoryMetrics";
import { Card } from "@/components/ui/card";

type DataDriftTabProps = {
  report: Record<string, unknown>;
  selectedMetrics?: string[];
};

export function DataDriftTab({ report, selectedMetrics = [] }: DataDriftTabProps) {
  const showCsi = hasInventoryMetric(selectedMetrics, "CSI");
  const showPsi = hasInventoryMetric(selectedMetrics, "PSI");
  const showTarget = hasInventoryMetric(selectedMetrics, "Target Shift");
  const hasDataDriftConfig = INVENTORY_DATA_DRIFT.some((m) => hasInventoryMetric(selectedMetrics, m));
  const { sessionId } = useSession();
  const [csiTopN, setCsiTopN] = useState<number>(15);
  const [selectedDistFeature, setSelectedDistFeature] = useState<string>("");
  const [selectedTargetBreakdown, setSelectedTargetBreakdown] = useState<string>("none");
  const [descView, setDescView] = useState<"raw" | "processed">("raw");
  const [downloadBusy, setDownloadBusy] = useState(false);
  const data = (report.data_drift ?? {}) as Record<string, unknown>;
  const datasets = (report.datasets ?? {}) as Record<string, unknown>;
  const target = (data.target_drift ?? {}) as Record<string, unknown>;
  const targetBreakdown = ((target.breakdown ?? {}) as Record<string, Array<{
    segment: string;
    train_obs: number;
    new_obs: number;
    train_events: number;
    new_events: number;
    train_rate: number;
    new_rate: number;
    delta_pp: number;
  }>>) || {};
  const csi = (data.feature_csi ?? {}) as Record<
    string,
    {
      value?: number;
      severity?: string;
      details?: { categories?: string[]; train_pct?: number[]; new_pct?: number[]; contrib?: number[] };
    }
  >;
  const missing = (data.missing_rate_drift ?? {}) as Record<
    string,
    { train_missing_pct?: number; new_missing_pct?: number; delta_pp?: number; severity?: "critical" | "moderate" | "stable" }
  >;
  const cardinality = (data.cardinality_drift ?? {}) as Record<string, { train_categories?: string[]; new_categories?: string[]; new_only?: string[]; lost?: string[] }>;
  const desc = (data.descriptive_stats ?? {}) as Record<string, unknown>;

  const csiRows = useMemo(
    () =>
      Object.entries(csi)
        .map(([feature, vals]) => ({ feature, csi: vals.value ?? 0, severity: vals.severity ?? "stable" }))
        .sort((a, b) => b.csi - a.csi),
    [csi],
  );
  const selectedFeature = selectedDistFeature || csiRows[0]?.feature || "";
  const selectedFeatureDetails = (csi[selectedFeature]?.details ?? {}) as {
    categories?: string[];
    bins?: number[];
    train_pct?: number[];
    new_pct?: number[];
    contrib?: number[];
  };
  const detailLabels = useMemo(() => {
    if ((selectedFeatureDetails.categories ?? []).length > 0) {
      return selectedFeatureDetails.categories ?? [];
    }
    const bins = selectedFeatureDetails.bins ?? [];
    if (bins.length < 2) return [];
    return Array.from({ length: bins.length - 1 }).map((_, idx) => `B${idx + 1}`);
  }, [selectedFeatureDetails]);
  const rawRows = useMemo(() => {
    const rawSource = ((desc.raw ?? {}) as Record<string, any>) || {};
    const processedSource = ((desc.processed ?? {}) as Record<string, any>) || {};
    const source = descView === "raw" ? rawSource : processedSource;

    let features = Object.keys(source);
    if (descView === "raw" && Object.keys(processedSource).length > 0) {
      const processedOrder = Object.keys(processedSource);
      const intersected = processedOrder.filter((feature) => feature in rawSource);
      features = intersected.length > 0 ? intersected : features;
    }

    return features
      .map((feature) => ({
        feature,
        training: source[feature]?.training ?? {},
        new: source[feature]?.new ?? {},
      }))
      .sort((a, b) => String(a.feature).localeCompare(String(b.feature)));
  }, [desc, descView]);
  const missingRows = useMemo(
    () =>
      Object.entries(missing)
        .map(([feature, vals]) => ({
          feature,
          trainMissingPct: Number(vals.train_missing_pct ?? 0),
          newMissingPct: Number(vals.new_missing_pct ?? 0),
          deltaPp: Number(vals.delta_pp ?? 0),
          severity: (vals.severity ?? "stable") as "critical" | "moderate" | "stable",
        }))
        .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp)),
    [missing],
  );
  const trainingN = Number(datasets.training_rows ?? 0);
  const newN = Number(datasets.new_rows ?? 0);
  const trainingRate = Number(target.training_rate ?? 0);
  const newRate = Number(target.new_rate ?? 0);
  const targetDeltaPp = Number(target.delta_pp ?? 0);
  const targetConclusion =
    Math.abs(targetDeltaPp) < 1
      ? "Target rate stable"
      : targetDeltaPp > 0
        ? "Target rate increased"
        : "Target rate decreased";
  const csiConclusion = useMemo(() => {
    if (csiRows.length === 0) return "No CSI results";
    const large = csiRows.filter((r) => r.severity === "large").length;
    const medium = csiRows.filter((r) => r.severity === "medium").length;
    if (large > 0) return `${large} feature(s) with large CSI drift`;
    if (medium > 0) return `${medium} feature(s) with medium CSI drift`;
    return "CSI stable across features";
  }, [csiRows]);
  const distributionRows = detailLabels.map((bin, idx) => ({
    bin,
    trainPct: Number(selectedFeatureDetails.train_pct?.[idx] ?? 0),
    newPct: Number(selectedFeatureDetails.new_pct?.[idx] ?? 0),
  }));
  const contributionRows = detailLabels.map((bin, idx) => ({
    bin,
    contribution: Number(selectedFeatureDetails.contrib?.[idx] ?? 0),
  }));
  const selectedTargetRows = selectedTargetBreakdown === "none"
    ? []
    : (targetBreakdown[selectedTargetBreakdown] ?? []);
  const targetBreakdownOptions = useMemo(() => {
    const entries = Object.entries(targetBreakdown).filter(([, rows]) => (rows ?? []).length > 0);
    return entries
      .map(([feature, rows]) => {
        const safeRows = rows ?? [];
        const segments = new Set(safeRows.map((row) => String(row.segment ?? "").trim()));
        const maxAbsDelta = Math.max(...safeRows.map((row) => Math.abs(Number(row.delta_pp ?? 0))), 0);
        const binaryOnly = segments.size <= 2 && [...segments].every((s) => s === "0" || s === "1" || s === "__NULL__");
        return { feature, maxAbsDelta, binaryOnly, segmentCount: segments.size };
      })
      .sort((a, b) => {
        if (a.binaryOnly !== b.binaryOnly) return a.binaryOnly ? 1 : -1;
        return b.maxAbsDelta - a.maxAbsDelta;
      })
      .map((item) => item.feature);
  }, [targetBreakdown]);

  const formatEventRate = (rate: number) => {
    const r = Number(rate);
    if (!Number.isFinite(r)) return "—";
    const pct = r <= 1 ? r * 100 : r;
    return `${pct.toFixed(2)}%`;
  };
  const targetChartTraining = trainingRate;
  const targetChartNew = newRate;
  const cardinalityRows = Object.entries(cardinality);
  const cardinalityCounts = {
    newCategory: cardinalityRows.filter(([, vals]) => (vals.new_only ?? []).length > 0).length,
    lostCategory: cardinalityRows.filter(([, vals]) => (vals.lost ?? []).length > 0).length,
    stable: cardinalityRows.filter(([, vals]) => (vals.new_only ?? []).length === 0 && (vals.lost ?? []).length === 0).length,
  };

  if (!hasDataDriftConfig && !showTarget) {
    return (
      <Card className="p-4 border-orange-300 bg-orange-50 dark:border-orange-500/30 dark:bg-orange-500/5">
        <p className="text-xs text-orange-800 dark:text-orange-300">
          No data drift metrics are selected in Inventory (PSI, CSI, IV, WOE). Select metrics on the Inventory page and
          rerun diagnostics.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {hasDataDriftConfig && (
      <>
      <ChartCard
          title="Descriptive statistics"
          subtitle={`${driftCompareSubtitle()}, with raw/processed toggle`}
          actions={(
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded border p-0.5">
                <button
                  type="button"
                  className={`px-3 py-1 text-xs rounded ${descView === "raw" ? "bg-secondary" : ""}`}
                  onClick={() => setDescView("raw")}
                >
                  Raw
                </button>
                <button
                  type="button"
                  className={`px-3 py-1 text-xs rounded ${descView === "processed" ? "bg-secondary" : ""}`}
                  onClick={() => setDescView("processed")}
                >
                  Processed
                </button>
              </div>
              <button
                type="button"
                className="h-8 rounded border px-2 text-xs bg-white dark:bg-slate-900 disabled:opacity-60"
                onClick={async () => {
                  if (!sessionId) return;
                  try {
                    setDownloadBusy(true);
                    await downloadDiagnosticsReportFile(sessionId, "descriptive", report);
                  } finally {
                    setDownloadBusy(false);
                  }
                }}
                disabled={!sessionId || downloadBusy}
              >
                {downloadBusy ? "Downloading..." : "Excel (Raw + Processed sheets)"}
              </button>
            </div>
          )}
        >
          <DescriptiveStatsCard rows={rawRows} />
        </ChartCard>

        <div className="space-y-3">
          <ChartCard title="Cardinality change — categorical features" subtitle={`New/lost category monitoring — raw ${driftCompareSubtitle()}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
              <span className="px-2 py-1 rounded border bg-red-500/10 border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 font-semibold uppercase tracking-wide">
                {cardinalityCounts.newCategory} New Category
              </span>
              <span className="px-2 py-1 rounded border bg-amber-500/10 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-300 font-semibold uppercase tracking-wide">
                {cardinalityCounts.lostCategory} Lost Category
              </span>
              <span className="px-2 py-1 rounded border bg-emerald-500/10 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-300 font-semibold uppercase tracking-wide">
                {cardinalityCounts.stable} Stable
              </span>
              <span className="px-2 py-1 rounded border bg-blue-500/10 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-300 font-semibold uppercase tracking-wide">
                Auto-Flagged
              </span>
            </div>
            <div className="space-y-2">
              {cardinalityRows.map(([feature, vals]) => (
                <CategoricalDriftRow
                  key={feature}
                  feature={feature}
                  trainCategories={vals.train_categories ?? []}
                  newCategories={vals.new_categories ?? []}
                  newOnly={vals.new_only ?? []}
                  lost={vals.lost ?? []}
                />
              ))}
            </div>
          </ChartCard>
          <ChartCard title="Missing Rate Drift" subtitle="Feature-wise table with severity filter">
            <MissingRateTable rows={missingRows} />
          </ChartCard>
        </div>
      </>
      )}

          {showTarget && (
          <ChartCard
            title="Target Drift"
            subtitle={`Event rate comparison — ${driftCompareSubtitle()}`}
            conclusion={targetConclusion}
            actions={(
              <div className="text-xs">
                <span className="text-muted-foreground mr-2">Break down by</span>
                <select
                  className="h-8 rounded border px-2 bg-background"
                  value={selectedTargetBreakdown}
                  onChange={(e) => setSelectedTargetBreakdown(e.target.value)}
                >
                  <option value="none">Overall (no segment)</option>
                  {targetBreakdownOptions.map((feature) => (
                    <option key={feature} value={feature}>{feature}</option>
                  ))}
                </select>
              </div>
            )}
          >
            
            {targetBreakdownOptions.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                No segment breakdown features available for this model (re-run diagnostics after update if you expect categorical splits).
              </p>
            )}
            <div className="mt-4">
              {/** Wireframe-aligned grouped chart by selected breakdown segment */}
              <TargetEventRateChart
                trainingRatePct={targetChartTraining}
                newRatePct={targetChartNew}
                breakdownRows={selectedTargetRows.map((row) => ({
                  segment: String(row.segment ?? ""),
                  trainingRatePct: Number(row.train_rate ?? 0),
                  newRatePct: Number(row.new_rate ?? 0),
                }))}
              />
            </div>
          </ChartCard>
          )}

          {showCsi && (
          <ChartCard
            title="Feature Drift (CSI)"
            subtitle="CSI ranked by model features with governance severity"
            conclusion={csiConclusion}
            actions={(
              <div className="text-xs">
                <span className="text-muted-foreground mr-2">Show top</span>
                <select
                  className="h-8 rounded border px-2 bg-background"
                  value={String(csiTopN)}
                  onChange={(e) => setCsiTopN(Number(e.target.value))}
                >
                  <option value="10">10</option>
                  <option value="15">15</option>
                  <option value="9999">All</option>
                </select>
              </div>
            )}
          >
            <CsiRankedChart rows={csiRows.slice(0, csiTopN === 9999 ? csiRows.length : csiTopN)} />
          </ChartCard>
          )}

          {(showPsi || showCsi) && (
          <ChartCard
            title="Distribution"
            subtitle={`${driftCompareSubtitle()} distribution and CSI contribution`}
            actions={(
              <select
                className="h-8 rounded border border-border px-2 bg-background text-foreground text-xs min-w-[12rem]"
                value={selectedFeature}
                onChange={(e) => setSelectedDistFeature(e.target.value)}
              >
                {csiRows.map((row) => (
                  <option key={row.feature} value={row.feature}>
                    {row.feature} (CSI {row.csi.toFixed(3)})
                  </option>
                ))}
              </select>
            )}
          >
            <DistributionExplorerCharts
              distributionRows={distributionRows}
              contributionRows={contributionRows}
            />
          </ChartCard>
          )}
    </div>
  );
}
