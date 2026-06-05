import { useMemo } from "react";
import { driftBaselineLabel, INGESTION_DATASETS } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { chartHeightForFeatureRows, featureLabelWidth } from "@/lib/chartLayout";
import { cartesianGrid, chartTooltipProps, horizontalBarMargin, useChartTheme } from "@/lib/chartTheme";

type Row = { feature: string; ivTrain: number; ivNew: number };
type IvStrengthChartProps = { rows: Row[] };

export function IvStrengthChart({ rows }: IvStrengthChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  const labels = rows.map((r) => r.feature);
  const yWidth = featureLabelWidth(labels);
  const height = chartHeightForFeatureRows(rows.length);

  const legend = useMemo(
    () => [
      { value: driftBaselineLabel(), type: "square" as const, color: theme.series.train, dataKey: "ivTrain" },
      { value: INGESTION_DATASETS.new_data_oos.label, type: "square" as const, color: theme.series.new, dataKey: "ivNew" },
    ],
    [theme.series.train, theme.series.new],
  );

  return (
    <ChartFrame theme={theme} height={height} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={horizontalBarMargin(yWidth, 4)}>
          <CartesianGrid {...cartesianGrid(theme, { horizontal: false })} />
          <XAxis {...chartXAxis(theme, "Information value (IV)", { type: "number", tickFormatter: fmt3 })} />
          <YAxis
            {...chartYAxis(theme, undefined, {
              type: "category",
              dataKey: "feature",
              width: yWidth,
              interval: 0,
            })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme)} />
          <Bar dataKey="ivTrain" fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
          <Bar dataKey="ivNew" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
