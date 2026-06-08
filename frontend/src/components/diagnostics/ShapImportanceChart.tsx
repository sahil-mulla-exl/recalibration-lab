import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const DEV_IMPORTANCE_LABEL = "Dev val";
const NEW_IMPORTANCE_LABEL = "New val";
import type { ShapImportanceRow } from "@/components/diagnostics/ShapImportanceTable";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { chartHeightForFeatureRows, featureLabelWidth } from "@/lib/chartLayout";
import { cartesianGrid, chartTooltipProps, formatChartValue, horizontalBarMargin, useChartTheme } from "@/lib/chartTheme";

type ShapImportanceChartProps = { rows: ShapImportanceRow[] };

export function ShapImportanceChart({ rows }: ShapImportanceChartProps) {
  const theme = useChartTheme();
  const fmt = formatChartValue;
  const labels = rows.map((r) => r.feature);
  const yWidth = featureLabelWidth(labels);
  const height = chartHeightForFeatureRows(rows.length);

  const legend = useMemo(
    () => [
      { value: DEV_IMPORTANCE_LABEL, type: "square" as const, color: theme.series.train, dataKey: "devImportance" },
      { value: NEW_IMPORTANCE_LABEL, type: "square" as const, color: theme.series.new, dataKey: "newImportance" },
    ],
    [theme.series.train, theme.series.new],
  );

  return (
    <ChartFrame theme={theme} height={height} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={horizontalBarMargin(yWidth, 4)}>
          <CartesianGrid {...cartesianGrid(theme, { horizontal: false })} />
          <XAxis {...chartXAxis(theme, "Mean |SHAP|", { type: "number", tickFormatter: fmt })} />
          <YAxis
            {...chartYAxis(theme, undefined, {
              type: "category",
              dataKey: "feature",
              width: yWidth,
              interval: 0,
            })}
          />
          <Tooltip formatter={(value) => fmt(value as number)} {...chartTooltipProps(theme)} />
          <Bar dataKey="devImportance" fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
          <Bar dataKey="newImportance" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
