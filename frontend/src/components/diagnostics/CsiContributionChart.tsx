import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type Row = { feature: string; contribution: number };
type CsiContributionChartProps = { rows: Row[] };

export function CsiContributionChart({ rows }: CsiContributionChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  return (
    <ChartPlot className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={chartMargin.labeledLeft}>
          <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
          <XAxis
            dataKey="feature"
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={50}
            label={axisLabel(theme, "Feature", "insideBottom", { offset: -8 })}
          />
          <YAxis
            tickFormatter={fmt3}
            width={52}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "CSI contribution", "insideLeft", { angle: -90, offset: 4 })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme)} />
          <Bar dataKey="contribution" name="CSI contribution" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={1} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
