import { useMemo } from "react";
import { driftBaselineLabel, INGESTION_DATASETS } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { cartesianGrid, chartMargin, chartTooltipProps, formatChartValue, formatChartPercent, useChartTheme } from "@/lib/chartTheme";

type Row = { bin: string; trainPct: number; newPct: number };
type FeatureDistributionChartProps = { rows: Row[] };

export function FeatureDistributionChart({ rows }: FeatureDistributionChartProps) {
  const theme = useChartTheme();
  const fmt = formatChartValue;

  const legend = useMemo(
    () => [
      { value: `${driftBaselineLabel()} %`, type: "square" as const, color: theme.series.train, dataKey: "trainPct" },
      { value: `${INGESTION_DATASETS.new_data_oos.label} %`, type: "square" as const, color: theme.series.new, dataKey: "newPct" },
    ],
    [theme.series.train, theme.series.new],
  );

  return (
    <ChartFrame theme={theme} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={chartMargin.xyTitles}>
          <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
          <XAxis {...chartXAxis(theme, "Value bin", { dataKey: "bin", interval: 0 })} />
          <YAxis
            {...chartYAxis(theme, "Cohort share (%)", {
              tickFormatter: (v) => formatChartPercent(v),
            })}
          />
          <Tooltip formatter={(value) => fmt(value as number)} {...chartTooltipProps(theme)} />
          <Bar dataKey="trainPct" fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
          <Bar dataKey="newPct" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
