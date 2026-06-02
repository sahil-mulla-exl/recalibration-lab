import { useMemo } from "react";
import { driftBaselineLabel, INGESTION_DATASETS } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { CARD_CHART_HEIGHT } from "@/lib/chartLayout";
import { cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type TargetEventRateChartProps = {
  trainingRatePct: number;
  newRatePct: number;
  breakdownRows?: Array<{
    segment: string;
    trainingRatePct: number;
    newRatePct: number;
  }>;
};

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
  const chartHeight = useBreakdown
    ? Math.min(480, Math.max(CARD_CHART_HEIGHT, data.length * 40 + 80))
    : CARD_CHART_HEIGHT;

  const legend = useMemo(
    () => [
      { value: driftBaselineLabel(), type: "square" as const, color: theme.series.train, dataKey: "training" },
      { value: INGESTION_DATASETS.new_data.label, type: "square" as const, color: theme.series.new, dataKey: "newData" },
    ],
    [theme.series.train, theme.series.new],
  );

  return (
    <ChartFrame theme={theme} height={chartHeight} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={chartMargin.xyTitles} barGap={8} barCategoryGap="20%">
          <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
          <XAxis {...chartXAxis(theme, "Segment", { dataKey: "sample", interval: 0 })} />
          <YAxis
            {...chartYAxis(theme, "Event rate (%)", {
              type: "number",
              domain: [0, yMax],
              tickCount: 6,
              allowDecimals: true,
              tickFormatter: (v) => `${fmt1(v)}%`,
            })}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              `${fmt1(value)}%`,
              name === "training" ? driftBaselineLabel() : INGESTION_DATASETS.new_data.label,
            ]}
            labelFormatter={(label) => `Segment: ${label}`}
            {...chartTooltipProps(theme)}
          />
          <Bar dataKey="training" fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={1} radius={[2, 2, 0, 0]} legendType="none" />
          <Bar dataKey="newData" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={1} radius={[2, 2, 0, 0]} legendType="none" />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
