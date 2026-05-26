import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { driftBaselineLabel, INGESTION_DATASETS } from "@/config/datasets";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { DiagnosticsChartLegend } from "@/components/diagnostics/DiagnosticsChartLegend";
import {
  axisLabel,
  axisTick,
  cartesianGrid,
  chartMargin,
  chartTooltipProps,
  useChartTheme,
} from "@/lib/chartTheme";

export type BivariatePoint = {
  x: string;
  train: number;
  new: number;
  trainPop?: number;
  newPop?: number;
};

type MonotonicityChartProps = {
  data: BivariatePoint[];
  monoTrain?: boolean;
  monoNew?: boolean;
};

export function MonotonicityChart({ data }: MonotonicityChartProps) {
  const theme = useChartTheme();

  const chartData = useMemo(
    () =>
      data.map((row, i) => {
        const label = String(row.x ?? "").trim() || `B${i + 1}`;
        return {
          label,
          newEventRatePct: Number(row.new ?? 0) * 100,
          trainEventRatePct: Number(row.train ?? 0) * 100,
          newPopulationPct: Number(row.newPop ?? 0),
          trainPopulationPct: Number(row.trainPop ?? 0),
        };
      }),
    [data],
  );

  const popMax = useMemo(
    () => Math.max(5, ...chartData.flatMap((r) => [r.newPopulationPct, r.trainPopulationPct])),
    [chartData],
  );

  const eventRateMax = useMemo(
    () => Math.max(5, ...chartData.flatMap((r) => [r.newEventRatePct, r.trainEventRatePct])),
    [chartData],
  );

  const devLabel = driftBaselineLabel();
  const newLabel = INGESTION_DATASETS.new_data.label;

  const legendPayload = useMemo(
    () => [
      { value: `${devLabel} population`, type: "square" as const, color: theme.series.dev, dataKey: "trainPopulationPct" },
      { value: `${newLabel} population`, type: "square" as const, color: theme.series.new, dataKey: "newPopulationPct" },
      { value: `${devLabel} event rate`, type: "line" as const, color: theme.series.dev, dataKey: "trainEventRatePct" },
      { value: `${newLabel} event rate`, type: "line" as const, color: theme.series.new, dataKey: "newEventRatePct" },
    ],
    [devLabel, newLabel, theme.series.dev, theme.series.new],
  );

  if (chartData.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No bivariate bin data for this feature.</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground mb-3">
          Bars show population % per bin (right axis). Lines show event rate % (left axis).
        </p>
        <ChartPlot className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ ...chartMargin.labeledLeft, right: 56 }}
              barGap={4}
              barCategoryGap="20%"
            >
              <CartesianGrid {...cartesianGrid(theme)} />
              <XAxis
                dataKey="label"
                tick={axisTick(theme)}
                stroke={theme.axisLine}
                label={axisLabel(theme, "Bin (1 = lowest feature value)", "insideBottom", { offset: -4 })}
              />
              <YAxis
                yAxisId="eventRate"
                orientation="left"
                tick={axisTick(theme)}
                stroke={theme.axisLine}
                domain={[0, Math.ceil(eventRateMax / 5) * 5]}
                tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                width={48}
                label={axisLabel(theme, "Event rate (%)", "insideLeft", { angle: -90, offset: 12 })}
              />
              <YAxis
                yAxisId="population"
                orientation="right"
                tick={axisTick(theme)}
                stroke={theme.axisLine}
                domain={[0, Math.ceil(popMax / 5) * 5]}
                tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                width={48}
                label={axisLabel(theme, "Population (%)", "insideRight", { angle: 90, offset: 12 })}
              />
              <Tooltip
                formatter={(value: number, name: string) => [`${Number(value).toFixed(2)}%`, name]}
                {...chartTooltipProps(theme)}
              />
              <Bar
                yAxisId="population"
                dataKey="trainPopulationPct"
                name={`${devLabel} population`}
                fill={theme.series.devFill}
                stroke={theme.series.dev}
                strokeWidth={1.5}
                legendType="none"
                radius={[4, 4, 0, 0]}
                barSize={14}
              />
              <Bar
                yAxisId="population"
                dataKey="newPopulationPct"
                name={`${newLabel} population`}
                fill={theme.series.newFill}
                stroke={theme.series.new}
                strokeWidth={1.5}
                legendType="none"
                radius={[4, 4, 0, 0]}
                barSize={14}
              />
              <Line
                yAxisId="eventRate"
                type="monotone"
                dataKey="trainEventRatePct"
                name={`${devLabel} event rate`}
                stroke={theme.series.dev}
                strokeWidth={2.5}
                legendType="none"
                dot={{ r: 3, fill: theme.series.dev, stroke: theme.series.dev }}
              />
              <Line
                yAxisId="eventRate"
                type="monotone"
                dataKey="newEventRatePct"
                name={`${newLabel} event rate`}
                stroke={theme.series.new}
                strokeWidth={2.5}
                legendType="none"
                dot={{ r: 3, fill: theme.series.new, stroke: theme.series.new }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPlot>
        <DiagnosticsChartLegend payload={legendPayload} theme={theme} align="center" />
      </div>
    </div>
  );
}
