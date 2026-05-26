import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartLegendProps, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";
import { chartHeightForFeatureRows, featureLabelWidth } from "@/lib/chartLayout";

import type { ShapImportanceRow } from "@/components/diagnostics/ShapImportanceTable";

type ShapImportanceChartProps = { rows: ShapImportanceRow[] };

export function ShapImportanceChart({ rows }: ShapImportanceChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  const labels = rows.map((r) => r.feature);
  const yWidth = featureLabelWidth(labels);
  const height = chartHeightForFeatureRows(rows.length);

  return (
    <ChartPlot style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: Math.max(56, yWidth * 0.35), bottom: 40 }}>
          <CartesianGrid {...cartesianGrid(theme, { horizontal: false })} />
          <XAxis
            type="number"
            tickFormatter={fmt3}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Mean |SHAP|", "insideBottom", { offset: -4 })}
          />
          <YAxis
            type="category"
            dataKey="feature"
            width={yWidth}
            interval={0}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Feature", "insideLeft", { angle: -90, offset: 4 })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme)} />
          <Legend {...chartLegendProps(theme)} />
          <Bar dataKey="devImportance" name={perfBaselineLabel()} fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={1} />
          <Bar dataKey="newImportance" name={perfNewLabel()} fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={1} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
