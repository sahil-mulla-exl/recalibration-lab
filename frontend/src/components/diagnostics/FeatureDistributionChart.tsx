import { driftBaselineLabel, INGESTION_DATASETS } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartLegendProps, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type Row = { bin: string; trainPct: number; newPct: number };
type FeatureDistributionChartProps = { rows: Row[] };

export function FeatureDistributionChart({ rows }: FeatureDistributionChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  return (
    <ChartPlot className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={chartMargin.labeledLeft}>
          <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
          <XAxis
            dataKey="bin"
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            interval={0}
            label={axisLabel(theme, "Value bin", "insideBottom", { offset: -4 })}
          />
          <YAxis
            tickFormatter={(v) => `${fmt3(v)}%`}
            width={52}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Cohort share (%)", "insideLeft", { angle: -90, offset: 4 })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme)} />
          <Legend {...chartLegendProps(theme)} />
          <Bar dataKey="trainPct" name={`${driftBaselineLabel()} %`} fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={1} />
          <Bar dataKey="newPct" name={`${INGESTION_DATASETS.new_data.label} %`} fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={1} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
