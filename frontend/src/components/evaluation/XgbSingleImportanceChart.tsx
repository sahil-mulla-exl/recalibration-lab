import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { chartHeightForFeatureRows, featureLabelWidth } from "@/lib/chartLayout";
import { cartesianGrid, chartTooltipProps, formatChartValue, horizontalBarMargin, useChartTheme } from "@/lib/chartTheme";

export type XgbImportanceBarRow = {
  feature: string;
  importance: number;
};

type XgbSingleImportanceChartProps = {
  rows: XgbImportanceBarRow[];
  color: string;
  fill: string;
  title: string;
};

export function XgbSingleImportanceChart({ rows, color, fill, title }: XgbSingleImportanceChartProps) {
  const theme = useChartTheme();
  const fmt = formatChartValue;
  const labels = rows.map((r) => r.feature);
  const yWidth = featureLabelWidth(labels);
  const height = chartHeightForFeatureRows(rows.length);

  const legend = useMemo(
    () => [{ value: title, type: "square" as const, color, dataKey: "importance" }],
    [color, title],
  );

  return (
    <ChartFrame theme={theme} height={height} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={horizontalBarMargin(yWidth, 4)}>
          <CartesianGrid {...cartesianGrid(theme, { horizontal: false })} />
          <XAxis {...chartXAxis(theme, "Importance", { type: "number", tickFormatter: fmt })} />
          <YAxis
            {...chartYAxis(theme, undefined, {
              type: "category",
              dataKey: "feature",
              width: yWidth,
              interval: 0,
            })}
          />
          <Tooltip formatter={(value) => fmt(value as number)} {...chartTooltipProps(theme)} />
          <Bar
            dataKey="importance"
            fill={fill}
            stroke={color}
            strokeWidth={theme.plot.barStrokeWidth}
            legendType="none"
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
