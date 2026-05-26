import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type GainsPoint = { x: number; dev: number; current: number };
type CumulativeGainsChartProps = { data: GainsPoint[] };

export function CumulativeGainsChart({ data }: CumulativeGainsChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  return (
    <ChartPlot className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={chartMargin.labeledLeft}>
          <CartesianGrid {...cartesianGrid(theme)} />
          <XAxis
            dataKey="x"
            tickFormatter={(v) => `${fmt3(v)}%`}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Population (%)", "insideBottom", { offset: -4 })}
          />
          <YAxis
            tickFormatter={(v) => `${fmt3(v)}%`}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Cumulative capture (%)", "insideLeft", { angle: -90, offset: 8 })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: "line" })} />
          <Line type="monotone" dataKey="dev" name={perfBaselineLabel()} stroke={theme.series.dev} strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="current" name={perfNewLabel()} stroke={theme.series.new} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
