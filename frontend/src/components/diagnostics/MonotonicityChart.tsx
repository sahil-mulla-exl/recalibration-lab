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
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { rateToPercent } from "@/lib/chartLayout";
import { cartesianGrid, chartMargin, chartTooltipProps, formatChartPercent, useChartTheme } from "@/lib/chartTheme";

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
          newEventRatePct: rateToPercent(Number(row.new ?? 0)),
          trainEventRatePct: rateToPercent(Number(row.train ?? 0)),
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
  const newLabel = INGESTION_DATASETS.new_data_oos.label;

  const legend = useMemo(
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
    <div className="w-full min-w-0">
      <p className="text-xs text-muted-foreground mb-2">
        Bars = population % (right axis). Lines = event rate % (left axis).
      </p>
      <ChartFrame theme={theme} legend={legend}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={chartMargin.dualAxis} barGap={4} barCategoryGap="20%">
            <CartesianGrid {...cartesianGrid(theme)} />
            <XAxis {...chartXAxis(theme, "Bin (1 = lowest feature value)", { dataKey: "label" })} />
            <YAxis
              {...chartYAxis(theme, "Event rate (%)", {
                yAxisId: "eventRate",
                domain: [0, Math.ceil(eventRateMax / 5) * 5],
                tickFormatter: (v) => formatChartPercent(v),
              })}
            />
            <YAxis
              {...chartYAxis(theme, "Population (%)", {
                yAxisId: "population",
                orientation: "right",
                domain: [0, Math.ceil(popMax / 5) * 5],
                tickFormatter: (v) => formatChartPercent(v),
              })}
            />
            <Tooltip
              formatter={(value: number, name: string) => [formatChartPercent(value), name]}
              {...chartTooltipProps(theme)}
            />
            <Bar
              yAxisId="population"
              dataKey="trainPopulationPct"
              fill={theme.series.devFill}
              stroke={theme.series.dev}
              strokeWidth={theme.plot.barStrokeWidth}
              legendType="none"
              radius={[4, 4, 0, 0]}
              barSize={14}
            />
            <Bar
              yAxisId="population"
              dataKey="newPopulationPct"
              fill={theme.series.newFill}
              stroke={theme.series.new}
              strokeWidth={theme.plot.barStrokeWidth}
              legendType="none"
              radius={[4, 4, 0, 0]}
              barSize={14}
            />
            <Line
              yAxisId="eventRate"
              type="monotone"
              dataKey="trainEventRatePct"
              stroke={theme.series.dev}
              strokeWidth={theme.plot.lineStrokeWidth}
              legendType="none"
              dot={{ r: 4, fill: theme.series.dev, stroke: theme.series.dev, strokeWidth: theme.plot.barStrokeWidth }}
              connectNulls
            />
            <Line
              yAxisId="eventRate"
              type="monotone"
              dataKey="newEventRatePct"
              stroke={theme.series.new}
              strokeWidth={theme.plot.lineStrokeWidth}
              legendType="none"
              dot={{ r: 4, fill: theme.series.new, stroke: theme.series.new, strokeWidth: theme.plot.barStrokeWidth }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
