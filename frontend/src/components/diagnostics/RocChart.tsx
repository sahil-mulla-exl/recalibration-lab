import { useMemo } from "react";
import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type RocPoint = { fpr: number; tpr: number };
type RocChartProps = { dev: RocPoint[]; current: RocPoint[] };

export function RocChart({ dev, current }: RocChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);

  const merged = useMemo(() => {
    const len = Math.max(dev.length, current.length);
    return Array.from({ length: len }, (_, i) => ({
      fpr: Number(dev[i]?.fpr ?? current[i]?.fpr ?? 0),
      devTpr: Number(dev[i]?.tpr ?? 0),
      newTpr: Number(current[i]?.tpr ?? 0),
    }));
  }, [dev, current]);

  const legend = useMemo(
    () => [
      { value: perfBaselineLabel(), type: "line" as const, color: theme.series.dev, dataKey: "devTpr" },
      { value: perfNewLabel(), type: "line" as const, color: theme.series.new, dataKey: "newTpr" },
    ],
    [theme.series.dev, theme.series.new],
  );

  return (
    <ChartFrame theme={theme} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={merged} margin={chartMargin.xyTitles}>
          <CartesianGrid {...cartesianGrid(theme)} />
          <XAxis
            {...chartXAxis(theme, "False positive rate", {
              type: "number",
              dataKey: "fpr",
              domain: [0, 1],
              tickFormatter: fmt3,
            })}
          />
          <YAxis
            {...chartYAxis(theme, "True positive rate", {
              type: "number",
              domain: [0, 1],
              tickFormatter: fmt3,
            })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: "line" })} />
          <Line dataKey="devTpr" name={perfBaselineLabel()} stroke={theme.series.dev} strokeWidth={2.5} dot={false} legendType="none" />
          <Line dataKey="newTpr" name={perfNewLabel()} stroke={theme.series.new} strokeWidth={2.5} dot={false} legendType="none" />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
