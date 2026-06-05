import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { ksMaxPopulationPct, maxKsFromChartData } from "@/lib/ksCurve";
import { cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type KsPoint = { population_pct: number; cum_pos_pct: number; cum_neg_pct: number; ks?: number };
type KsChartProps = { data: KsPoint[] };

export function KsChart({ data }: KsChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  const ksMax = maxKsFromChartData(data);
  const ksPopPct = ksMaxPopulationPct(data);

  const legend = useMemo(
    () => [
      { value: "Cumulative positives", type: "line" as const, color: theme.series.new, dataKey: "cum_pos_pct" },
      { value: "Cumulative negatives", type: "line" as const, color: theme.series.dev, dataKey: "cum_neg_pct" },
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
              dataKey: "population_pct",
              type: "number",
              domain: [0, 100] as [number, number],
              tickFormatter: (v) => `${fmt3(v)}%`,
            })}
          />
          <YAxis
            {...chartYAxis(theme, "Cumulative rate (%)", {
              type: "number",
              domain: [0, 100] as [number, number],
              tickFormatter: (v) => `${fmt3(v)}%`,
            })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: "line" })} />
          <Line type="monotone" dataKey="cum_pos_pct" stroke={theme.series.new} strokeWidth={theme.plot.lineStrokeWidth} dot={false} legendType="none" />
          <Line type="monotone" dataKey="cum_neg_pct" stroke={theme.series.dev} strokeWidth={theme.plot.lineStrokeWidth} dot={false} legendType="none" />
          {ksPopPct != null && Number.isFinite(ksPopPct) && (
            <ReferenceLine
              x={ksPopPct}
              stroke={theme.series.trend}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
              label={{
                value: ksMax != null ? `KS ${fmt3(ksMax)}%` : "KS max",
                position: "insideTop",
                fontSize: 10,
                fill: theme.axis,
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
