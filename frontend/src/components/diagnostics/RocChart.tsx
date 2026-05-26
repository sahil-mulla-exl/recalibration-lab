import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type RocPoint = { fpr: number; tpr: number };
type RocChartProps = { dev: RocPoint[]; current: RocPoint[] };

export function RocChart({ dev, current }: RocChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  return (
    <ChartPlot className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={chartMargin.labeledLeft}>
          <CartesianGrid {...cartesianGrid(theme)} />
          <XAxis
            type="number"
            dataKey="fpr"
            domain={[0, 1]}
            tickFormatter={fmt3}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "False positive rate", "insideBottom", { offset: -4 })}
          />
          <YAxis
            type="number"
            dataKey="tpr"
            domain={[0, 1]}
            tickFormatter={fmt3}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "True positive rate", "insideLeft", { angle: -90, offset: 8 })}
          />
          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme, { cursor: "line" })} />
          <Line data={dev} dataKey="tpr" name={perfBaselineLabel()} stroke={theme.series.dev} strokeWidth={2.5} dot={false} />
          <Line data={current} dataKey="tpr" name={perfNewLabel()} stroke={theme.series.new} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
