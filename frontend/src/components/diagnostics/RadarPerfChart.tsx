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
import { chartMargin, chartTooltipProps, formatChartValue, useChartTheme } from "@/lib/chartTheme";

type RadarPerfChartProps = {
  data: Array<{ metric: string; dev: number; current: number }>;
};

/** Radar axes use a fixed 0–1 scale; tooltips show the underlying metric values. */
const RADAR_DOMAIN: [number, number] = [0, 1];

export function RadarPerfChart({ data }: RadarPerfChartProps) {
  const theme = useChartTheme();
  const fmt = formatChartValue;

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
            domain={RADAR_DOMAIN}
            tick={false}
            axisLine={false}
            stroke={theme.axisLine}
          />
          <Tooltip formatter={(value) => fmt(value as number)} {...chartTooltipProps(theme, { cursor: false })} />
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
