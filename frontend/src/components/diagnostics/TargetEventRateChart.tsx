import { driftBaselineLabel, INGESTION_DATASETS } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartLegendProps, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type TargetEventRateChartProps = {
  /** Event rate as proportion (0.095) or percent (9.5) */
  trainingRatePct: number;
  newRatePct: number;
  breakdownRows?: Array<{
    segment: string;
    trainingRatePct: number;
    newRatePct: number;
  }>;
};

/** Normalize to 0–100 scale for chart axis */
function toChartPercent(rate: number): number {
  const r = Number(rate);
  if (!Number.isFinite(r)) return 0;
  return r <= 1 ? r * 100 : r;
}

function niceYMax(maxPct: number): number {
  if (maxPct <= 0) return 10;
  const padded = maxPct * 1.12;
  return Math.min(100, Math.max(10, Math.ceil(padded / 5) * 5));
}

export function TargetEventRateChart({ trainingRatePct, newRatePct, breakdownRows = [] }: TargetEventRateChartProps) {
  const theme = useChartTheme();
  const fmt1 = (v: number | string) => Number(v).toFixed(1);

  const useBreakdown = breakdownRows.length > 0;
  const data = useBreakdown
    ? breakdownRows.map((row) => ({
        sample: String(row.segment ?? ""),
        training: toChartPercent(row.trainingRatePct),
        newData: toChartPercent(row.newRatePct),
      }))
    : [
        {
          sample: "Overall",
          training: toChartPercent(trainingRatePct),
          newData: toChartPercent(newRatePct),
        },
      ];

  const maxRate = data.reduce(
    (acc, row) => Math.max(acc, Number(row.training ?? 0), Number(row.newData ?? 0)),
    0,
  );
  const yMax = niceYMax(maxRate);
  const chartHeight = useBreakdown ? Math.min(520, Math.max(256, data.length * 40 + 72)) : 256;

  return (
    <ChartPlot style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={chartMargin.labeledLeft} barGap={8} barCategoryGap="20%">
          <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
          <XAxis
            dataKey="sample"
            tick={axisTick(theme)}
            interval={0}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Segment", "insideBottom", { offset: -4 })}
          />
          <YAxis
            type="number"
            domain={[0, yMax]}
            tickCount={6}
            allowDecimals
            width={52}
            tickFormatter={(v) => `${fmt1(v)}%`}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Event rate (%)", "insideLeft", { angle: -90, offset: 4 })}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              `${fmt1(value)}%`,
              name === "training" ? driftBaselineLabel() : INGESTION_DATASETS.new_data.label,
            ]}
            labelFormatter={(label) => `Segment: ${label}`}
            {...chartTooltipProps(theme)}
          />
          <Legend
            {...chartLegendProps(theme, {
              verticalAlign: "bottom",
              height: 28,
              formatter: (value) => (value === "training" ? driftBaselineLabel() : INGESTION_DATASETS.new_data.label),
            })}
          />
          <Bar dataKey="training" name="training" fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={1} radius={[2, 2, 0, 0]} />
          <Bar dataKey="newData" name="newData" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={1} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
