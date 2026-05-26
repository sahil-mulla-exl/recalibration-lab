import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartLegendProps, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type DecileRow = { decile: string; dev: number; current: number };
type DecileChartProps = { data: DecileRow[] };

export function DecileChart({ data }: DecileChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  return (
    <ChartPlot className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={chartMargin.labeledLeft}>
          <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
          <XAxis
            dataKey="decile"
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Score decile", "insideBottom", { offset: -4 })}
          />
          <YAxis
            tickFormatter={fmt3}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Event rate", "insideLeft", { angle: -90, offset: 8 })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme)} />
          <Legend {...chartLegendProps(theme)} />
          <Bar dataKey="dev" name={perfBaselineLabel()} fill={theme.series.devFill} stroke={theme.series.dev} strokeWidth={1} />
          <Bar dataKey="current" name={perfNewLabel()} fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={1} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
