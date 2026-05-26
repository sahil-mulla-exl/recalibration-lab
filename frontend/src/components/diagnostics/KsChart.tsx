import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type KsPoint = { population_pct: number; cum_pos_pct: number; cum_neg_pct: number };
type KsChartProps = { data: KsPoint[] };

export function KsChart({ data }: KsChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  return (
    <ChartPlot className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={chartMargin.labeledLeft}>
          <CartesianGrid {...cartesianGrid(theme)} />
          <XAxis
            dataKey="population_pct"
            tickFormatter={(v) => `${fmt3(v)}%`}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Population (%)", "insideBottom", { offset: -4 })}
          />
          <YAxis
            tickFormatter={fmt3}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Cumulative rate", "insideLeft", { angle: -90, offset: 8 })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: "line" })} />
          <Line type="monotone" dataKey="cum_pos_pct" name="Cumulative positives" stroke={theme.series.new} strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="cum_neg_pct" name="Cumulative negatives" stroke={theme.series.dev} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
