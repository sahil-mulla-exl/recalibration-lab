import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { useMemo } from "react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type RadarPerfChartProps = {
  data: Array<{ metric: string; dev: number; current: number }>;
};

export function RadarPerfChart({ data }: RadarPerfChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  const domain = useMemo(() => {
    const values = data
      .flatMap((row) => [Number(row.dev), Number(row.current)])
      .filter((v) => Number.isFinite(v));
    if (values.length === 0) return [0, 1] as [number, number];
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    if (minValue === maxValue) {
      const pad = Math.max(Math.abs(minValue) * 0.05, 0.01);
      return [minValue - pad, maxValue + pad] as [number, number];
    }
    const range = maxValue - minValue;
    const pad = Math.max(range * 0.1, 0.01);
    return [Math.max(0, minValue - pad), maxValue + pad] as [number, number];
  }, [data]);

  return (
    <ChartPlot className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke={theme.radar.grid} />
          <PolarAngleAxis dataKey="metric" tick={{ ...axisTick(theme), fontSize: 10 }} />
          <PolarRadiusAxis
            domain={domain}
            tickCount={5}
            tickFormatter={fmt3}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Metric value", "insideLeft", { angle: -90, offset: 4 })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: false })} />
          <Radar dataKey="dev" name={perfBaselineLabel()} stroke={theme.series.dev} fill={theme.series.devFill} strokeWidth={2} />
          <Radar dataKey="current" name={perfNewLabel()} stroke={theme.series.new} fill={theme.series.newFill} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
