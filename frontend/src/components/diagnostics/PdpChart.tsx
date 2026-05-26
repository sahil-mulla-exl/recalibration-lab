import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartLegendProps, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type Point = { x: number | string; y: number };
type PdpChartProps = {
  dev: Point[];
  current: Point[];
  chartType?: "line" | "bar";
};

export function PdpChart({ dev, current, chartType = "line" }: PdpChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  const data = dev.map((d, i) => ({
    x: d.x,
    dev: d.y,
    current: current[i]?.y ?? null,
  }));

  if (chartType === "bar") {
    return (
      <ChartPlot className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={chartMargin.labeledLeft}>
            <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
            <XAxis
              dataKey="x"
              tick={axisTick(theme)}
              stroke={theme.axisLine}
              label={axisLabel(theme, "Feature value (bin)", "insideBottom", { offset: -4 })}
            />
            <YAxis
              tickFormatter={fmt3}
              tick={axisTick(theme)}
              stroke={theme.axisLine}
              label={axisLabel(theme, "Partial dependence", "insideLeft", { angle: -90, offset: 8 })}
            />
            <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme)} />
            <Legend {...chartLegendProps(theme)} />
            <Bar dataKey="dev" name={perfBaselineLabel()} fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={1} />
            <Bar dataKey="current" name={perfNewLabel()} fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={1} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPlot>
    );
  }

  return (
    <ChartPlot className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={chartMargin.labeledLeft}>
          <CartesianGrid {...cartesianGrid(theme)} />
          <XAxis
            dataKey="x"
            tickFormatter={fmt3}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Feature value (bin)", "insideBottom", { offset: -4 })}
          />
          <YAxis
            tickFormatter={fmt3}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Partial dependence", "insideLeft", { angle: -90, offset: 8 })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: "line" })} />
          <Legend {...chartLegendProps(theme)} />
          <Line type="monotone" dataKey="dev" name={perfBaselineLabel()} stroke={theme.series.train} strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="current" name={perfNewLabel()} stroke={theme.series.new} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
