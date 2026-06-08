import { useMemo } from "react";
import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { cartesianGrid, chartMargin, chartTooltipProps, formatChartValue, formatChartPercent, useChartTheme } from "@/lib/chartTheme";

type Point = { x: number | string; y: number };
type PdpChartProps = {
  dev: Point[];
  current: Point[];
  chartType?: "line" | "bar";
};

function mergePdpPoints(dev: Point[], current: Point[]) {
  const key = (v: number | string) => String(v);
  const map = new Map<string, { x: number | string; dev: number | null; current: number | null }>();
  for (const p of dev) {
    map.set(key(p.x), { x: p.x, dev: p.y, current: null });
  }
  for (const p of current) {
    const k = key(p.x);
    const row = map.get(k);
    if (row) row.current = p.y;
    else map.set(k, { x: p.x, dev: null, current: p.y });
  }
  const rows = [...map.values()];
  const allNumeric = rows.every((r) => Number.isFinite(Number(r.x)));
  if (allNumeric) rows.sort((a, b) => Number(a.x) - Number(b.x));
  return rows;
}

function formatPdpX(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (Math.abs(n) >= 100 || (Math.abs(n) > 0 && Math.abs(n) < 0.01)) return n.toExponential(2);
  return n.toFixed(1);
}

export function PdpChart({ dev, current, chartType = "line" }: PdpChartProps) {
  const theme = useChartTheme();
  const fmt = formatChartValue;
  const data = useMemo(() => mergePdpPoints(dev, current), [dev, current]);

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

  const xTickFormatter = chartType === "bar" ? (v: number | string) => String(v) : formatPdpX;

  if (chartType === "bar") {
    return (
      <ChartFrame theme={theme} legend={legend}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={chartMargin.xyTitles}>
            <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />
            <XAxis {...chartXAxis(theme, "Feature value", { dataKey: "x", tickFormatter: xTickFormatter })} />
            <YAxis {...chartYAxis(theme, "Partial dependence", { tickFormatter: fmt })} />
            <Tooltip formatter={(value) => fmt(value as number)} {...chartTooltipProps(theme)} />
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
          <XAxis {...chartXAxis(theme, "Feature value (bin)", { dataKey: "x", tickFormatter: xTickFormatter })} />
          <YAxis {...chartYAxis(theme, "Partial dependence", { tickFormatter: fmt })} />
          <Tooltip formatter={(value) => fmt(value as number)} {...chartTooltipProps(theme, { cursor: "line" })} />
          <Line type="monotone" dataKey="dev" stroke={theme.series.train} strokeWidth={theme.plot.lineStrokeWidth} dot={false} legendType="none" connectNulls />
          <Line type="monotone" dataKey="current" stroke={theme.series.new} strokeWidth={theme.plot.lineStrokeWidth} dot={false} legendType="none" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
