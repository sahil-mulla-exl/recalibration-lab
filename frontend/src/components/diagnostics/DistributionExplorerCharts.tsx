import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { driftBaselineLabel, INGESTION_DATASETS } from "@/config/datasets";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { DiagnosticsChartLegend } from "@/components/diagnostics/DiagnosticsChartLegend";
import { categoryAxisLayout } from "@/lib/chartLayout";
import {
  axisLabel,
  axisTick,
  cartesianGrid,
  chartTooltipProps,
  useChartTheme,
} from "@/lib/chartTheme";

const Y_AXIS_WIDTH = 56;
const PLOT_HEIGHT = 200;

/** Distinct cohort colors (slate + orange) */
function csiBarColors(isDark: boolean) {
  return isDark
    ? { fill: "rgba(167, 139, 250, 0.8)", stroke: "#c4b5fd" }
    : { fill: "rgba(79, 70, 229, 0.75)", stroke: "#4338ca" };
}

type DistributionRow = { bin: string; trainPct: number; newPct: number };
type ContributionRow = { bin: string; contribution: number };

type DistributionExplorerChartsProps = {
  distributionRows: DistributionRow[];
  contributionRows: ContributionRow[];
};

function toDisplayPct(v: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

function formatContrib(v: number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  if (Math.abs(n) < 0.01) return n.toFixed(4);
  return n.toFixed(3);
}

export function DistributionExplorerCharts({
  distributionRows,
  contributionRows,
}: DistributionExplorerChartsProps) {
  const theme = useChartTheme();
  const csiColors = csiBarColors(theme.isDark);

  const distData = useMemo(
    () =>
      distributionRows.map((row) => ({
        bin: String(row.bin ?? ""),
        trainPct: toDisplayPct(row.trainPct),
        newPct: toDisplayPct(row.newPct),
      })),
    [distributionRows],
  );

  const contribData = useMemo(
    () =>
      contributionRows.map((row) => ({
        bin: String(row.bin ?? ""),
        contribution: Number(row.contribution ?? 0),
      })),
    [contributionRows],
  );

  const contribMax = useMemo(
    () => Math.max(0.0001, ...contribData.map((r) => r.contribution)),
    [contribData],
  );

  const distMax = useMemo(
    () => Math.max(5, ...distData.flatMap((r) => [r.trainPct, r.newPct])),
    [distData],
  );

  const binLabels = useMemo(
    () => distData.map((d) => d.bin),
    [distData],
  );
  const xLayout = useMemo(() => categoryAxisLayout(binLabels), [binLabels]);
  const chartMargin = useMemo(
    () => ({
      top: 12,
      right: 16,
      left: Y_AXIS_WIDTH,
      bottom: xLayout.marginBottom,
    }),
    [xLayout.marginBottom],
  );
  const totalHeight = PLOT_HEIGHT + xLayout.height + 12;

  const distributionLegendPayload = useMemo(
    () => [
      { value: `${driftBaselineLabel()} %`, type: "square", color: theme.series.train, dataKey: "trainPct" },
      { value: `${INGESTION_DATASETS.new_data.label} %`, type: "square", color: theme.series.new, dataKey: "newPct" },
    ],
    [theme.series.train, theme.series.new],
  );

  const csiLegendPayload = useMemo(
    () => [
      { value: "CSI contribution", type: "square", color: csiColors.stroke, dataKey: "contribution" },
    ],
    [csiColors.stroke],
  );

  const xAxisProps = {
    dataKey: "bin" as const,
    tick: { ...axisTick(theme), dy: 2 },
    stroke: theme.axisLine,
    interval: 0 as const,
    angle: xLayout.angle,
    textAnchor: xLayout.textAnchor,
    height: xLayout.height,
    tickMargin: 4,
  };

  if (distData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No distribution data for this feature. Re-run diagnostics or choose another feature.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 items-end">
      {/* Distribution — cohort % */}
      <div className="min-w-0 flex flex-col">
        <ChartPlot style={{ height: totalHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distData} margin={chartMargin} barGap={4} barCategoryGap="18%">
              <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
              <XAxis
                {...xAxisProps}
                label={axisLabel(theme, "Value bin", "insideBottom", { offset: -6 })}
              />
              <YAxis
                domain={[0, Math.ceil(distMax / 5) * 5]}
                tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                width={Y_AXIS_WIDTH}
                tick={axisTick(theme)}
                stroke={theme.axisLine}
                label={axisLabel(theme, "Cohort share (%)", "insideLeft", { angle: -90, offset: 4 })}
              />
              <Tooltip
                formatter={(value: number) => [`${Number(value).toFixed(2)}%`, ""]}
                {...chartTooltipProps(theme)}
              />
              <Bar
                dataKey="trainPct"
                name={`${driftBaselineLabel()} %`}
                fill={theme.series.trainFill}
                stroke={theme.series.train}
                strokeWidth={1}
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="newPct"
                name={`${INGESTION_DATASETS.new_data.label} %`}
                fill={theme.series.newFill}
                stroke={theme.series.new}
                strokeWidth={1}
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartPlot>
        <DiagnosticsChartLegend
          payload={distributionLegendPayload}
          theme={theme}
          align="center"
        />
      </div>

      {/* CSI contribution — separate color scale */}
      <div className="min-w-0 flex flex-col">
        <ChartPlot style={{ height: totalHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={contribData} margin={chartMargin} barCategoryGap="18%">
              <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
              <XAxis
                {...xAxisProps}
                label={axisLabel(theme, "Value bin", "insideBottom", { offset: -6 })}
              />
              <YAxis
                domain={[0, contribMax * 1.12]}
                tickFormatter={formatContrib}
                width={Y_AXIS_WIDTH}
                tick={axisTick(theme)}
                stroke={theme.axisLine}
                label={axisLabel(theme, "CSI contribution", "insideLeft", { angle: -90, offset: 4 })}
              />
              <Tooltip
                formatter={(value: number) => [formatContrib(value), "CSI contribution"]}
                {...chartTooltipProps(theme)}
              />
              <Bar
                dataKey="contribution"
                name="CSI contribution"
                fill={csiColors.fill}
                stroke={csiColors.stroke}
                strokeWidth={1}
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartPlot>
        <DiagnosticsChartLegend payload={csiLegendPayload} theme={theme} align="center" />
      </div>
    </div>
  );
}
