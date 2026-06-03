import { useMemo } from "react";
import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

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

  const legend = useMemo(
    () => [
      {
        value: perfBaselineLabel(),
        type: (chartType === "bar" ? "square" : "line") as "square" | "line",
        color: theme.series.train,
        dataKey: "dev",
      },
      {
        value: perfNewLabel(),
        type: (chartType === "bar" ? "square" : "line") as "square" | "line",
        color: theme.series.new,
        dataKey: "current",
      },
    ],
    [chartType, theme.series.train, theme.series.new],
  );

  if (chartType === "bar") {
    return (
      <ChartFrame theme={theme} legend={legend}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={chartMargin.xyTitles}>
            <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
            <XAxis {...chartXAxis(theme, "Feature value (bin)", { dataKey: "x" })} />
            <YAxis {...chartYAxis(theme, "Partial dependence", { tickFormatter: fmt3 })} />
            <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme)} />
            <Bar dataKey="dev" fill={theme.series.trainFill} stroke={theme.series.train} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
            <Bar dataKey="current" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame theme={theme} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={chartMargin.xyTitles}>
          <CartesianGrid {...cartesianGrid(theme)} />
          <XAxis {...chartXAxis(theme, "Feature value (bin)", { dataKey: "x", tickFormatter: fmt3 })} />
          <YAxis {...chartYAxis(theme, "Partial dependence", { tickFormatter: fmt3 })} />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: "line" })} />
          <Line type="monotone" dataKey="dev" stroke={theme.series.train} strokeWidth={theme.plot.lineStrokeWidth} dot={false} legendType="none" />
          <Line type="monotone" dataKey="current" stroke={theme.series.new} strokeWidth={theme.plot.lineStrokeWidth} dot={false} legendType="none" />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
