import { useMemo } from "react";
import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type GainsPoint = { x: number; dev: number; current: number };
type CumulativeGainsChartProps = { data: GainsPoint[] };

export function CumulativeGainsChart({ data }: CumulativeGainsChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);

  const legend = useMemo(
    () => [
      { value: perfBaselineLabel(), type: "line" as const, color: theme.series.dev, dataKey: "dev" },
      { value: perfNewLabel(), type: "line" as const, color: theme.series.new, dataKey: "current" },
    ],
    [theme.series.dev, theme.series.new],
  );

  return (
    <ChartFrame theme={theme} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={chartMargin.xyTitles}>
          <CartesianGrid {...cartesianGrid(theme)} />
          <XAxis
            {...chartXAxis(theme, "Population (%)", {
              dataKey: "x",
              tickFormatter: (v) => `${fmt3(v)}%`,
            })}
          />
          <YAxis
            {...chartYAxis(theme, "Cumulative capture (%)", {
              tickFormatter: (v) => `${fmt3(v)}%`,
            })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: "line" })} />
          <Line type="monotone" dataKey="dev" stroke={theme.series.dev} strokeWidth={2.5} dot={false} legendType="none" />
          <Line type="monotone" dataKey="current" stroke={theme.series.new} strokeWidth={2.5} dot={false} legendType="none" />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
