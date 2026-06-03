import { useMemo } from "react";
import { driftBaselineLabel, INGESTION_DATASETS } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { chartHeightForFeatureRows, featureLabelWidth } from "@/lib/chartLayout";
import { cartesianGrid, chartTooltipProps, horizontalBarMargin, useChartTheme } from "@/lib/chartTheme";

type Row = { feature: string; devAuc: number; newAuc: number };
type UnivariateAucChartProps = {
  rows: Row[];
  baselineLabel?: string;
  compareLabel?: string;
};

export function UnivariateAucChart({
  rows,
  baselineLabel = driftBaselineLabel(),
  compareLabel = INGESTION_DATASETS.new_data.label,
}: UnivariateAucChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  const labels = rows.map((r) => r.feature);
  const yWidth = featureLabelWidth(labels);
  const height = chartHeightForFeatureRows(rows.length, 32);
  const xDomain = useMemo(() => {
    const vals = rows.flatMap((r) => [Number(r.devAuc), Number(r.newAuc)]).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return [0.5, 1] as [number, number];
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const pad = Math.max(0.02, (maxV - minV) * 0.15);
    return [Math.min(0, minV - pad), Math.max(0.05, maxV + pad)] as [number, number];
  }, [rows]);

  const legend = useMemo(
    () => [
      { value: baselineLabel, type: "square" as const, color: theme.series.train, dataKey: "devAuc" },
      { value: compareLabel, type: "square" as const, color: theme.series.new, dataKey: "newAuc" },
    ],
    [baselineLabel, compareLabel, theme.series.train, theme.series.new],
  );

  return (
    <ChartFrame theme={theme} height={height} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={horizontalBarMargin(yWidth, 4)}>
          <CartesianGrid {...cartesianGrid(theme, { horizontal: false })} />
          <XAxis
            {...chartXAxis(theme, "Univariate AUC", {
              type: "number",
              domain: xDomain,
              tickFormatter: fmt3,
            })}
          />
          <YAxis
            {...chartYAxis(theme, undefined, {
              type: "category",
              dataKey: "feature",
              width: yWidth,
              interval: 0,
            })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme)} />
          <Bar dataKey="devAuc" fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
          <Bar dataKey="newAuc" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
