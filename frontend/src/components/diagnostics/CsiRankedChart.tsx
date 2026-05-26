import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import { axisLabel, axisTick, cartesianGrid, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";
import { featureLabelWidth } from "@/lib/chartLayout";

type Row = { feature: string; csi: number; severity: string };
type CsiRankedChartProps = { rows: Row[] };

const SEVERITY_COLOR: Record<string, string> = {
  stable: "#34D399",
  medium: "#FACC15",
  large: "#FB4E0B",
};

export function CsiRankedChart({ rows }: CsiRankedChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  const data = rows.map((row) => ({
    ...row,
    label: row.feature.length > 28 ? `${row.feature.slice(0, 26)}…` : row.feature,
  }));
  const chartHeight = Math.max(240, data.length * 28);
  const yWidth = Math.min(180, featureLabelWidth(data.map((d) => d.label)));

  return (
    <ChartPlot style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: Math.max(48, yWidth * 0.3), right: 16, top: 8, bottom: 40 }}>
          <CartesianGrid {...cartesianGrid(theme, { horizontal: false })} />
          <XAxis
            type="number"
            tickFormatter={fmt3}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "CSI value", "insideBottom", { offset: -4 })}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={yWidth}
            tick={axisTick(theme)}
            stroke={theme.axisLine}
            label={axisLabel(theme, "Feature", "insideLeft", { angle: -90, offset: 4 })}
          />
          <Tooltip
            formatter={(value) => fmt3(value as number)}
            labelFormatter={(_, payload) => {
              const item = payload?.[0]?.payload as Row & { label?: string } | undefined;
              return item?.feature ?? "";
            }}
            {...chartTooltipProps(theme)}
          />
          <Bar dataKey="csi" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.feature} fill={SEVERITY_COLOR[entry.severity] ?? theme.series.new} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartPlot>
  );
}
