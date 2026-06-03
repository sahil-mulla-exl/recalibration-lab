import { perfBaselineShortLabel, perfNewShortLabel } from "@/config/datasets";
import { useMemo } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { CARD_CHART_HEIGHT_RADAR } from "@/lib/chartLayout";
import { axisTick, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type RadarPerfChartProps = {
  data: Array<{ metric: string; dev: number; current: number }>;
};

export function RadarPerfChart({ data }: RadarPerfChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);

  const domain = useMemo((): [number, number] => {
    const values = data
      .flatMap((row) => [Number(row.dev), Number(row.current)])
      .filter((v) => Number.isFinite(v));
    if (values.length === 0) return [0, 1];
    const maxValue = Math.max(...values);
    if (maxValue <= 1.01) return [0, 1];
    const minValue = Math.min(...values);
    const pad = Math.max((maxValue - minValue) * 0.08, maxValue * 0.05, 0.01);
    return [Math.max(0, minValue - pad), maxValue + pad];
  }, [data]);

  const legend = useMemo(
    () => [
      { value: perfBaselineShortLabel(), type: "line" as const, color: theme.series.dev, dataKey: "dev" },
      { value: perfNewShortLabel(), type: "line" as const, color: theme.series.new, dataKey: "current" },
    ],
    [theme.series.dev, theme.series.new],
  );

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No performance metrics for radar view.</p>;
  }

  return (
    <ChartFrame theme={theme} height={CARD_CHART_HEIGHT_RADAR} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart
          data={data}
          margin={{ ...chartMargin.radar, top: 28, right: 36, bottom: 28, left: 36 }}
          outerRadius="72%"
          cx="50%"
          cy="50%"
        >
          <PolarGrid stroke={theme.radar.grid} />
          <PolarAngleAxis
            dataKey="metric"
            tick={{ fontSize: 11, fill: theme.axis }}
            tickLine={false}
          />
          <PolarRadiusAxis
            domain={domain}
            tick={false}
            axisLine={false}
            stroke={theme.axisLine}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: false })} />
          <Radar
            dataKey="dev"
            name={perfBaselineShortLabel()}
            stroke={theme.series.dev}
            fill={theme.series.devFill}
            fillOpacity={theme.plot.radarFillOpacity}
            strokeWidth={theme.plot.lineStrokeWidth}
            legendType="none"
          />
          <Radar
            dataKey="current"
            name={perfNewShortLabel()}
            stroke={theme.series.new}
            fill={theme.series.newFill}
            fillOpacity={theme.plot.radarFillOpacity}
            strokeWidth={theme.plot.lineStrokeWidth}
            legendType="none"
          />
        </RadarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
