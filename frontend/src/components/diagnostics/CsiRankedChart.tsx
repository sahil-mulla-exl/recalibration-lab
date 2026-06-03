import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { chartHeightForFeatureRows, featureLabelWidth } from "@/lib/chartLayout";
import { cartesianGrid, chartTooltipProps, horizontalBarMargin, severityColor, useChartTheme } from "@/lib/chartTheme";

type Row = { feature: string; csi: number; severity: string };
type CsiRankedChartProps = { rows: Row[] };

export function CsiRankedChart({ rows }: CsiRankedChartProps) {
  const theme = useChartTheme();
  const fmt3 = (v: number | string) => Number(v).toFixed(3);
  const labels = rows.map((r) => r.feature);
  const yWidth = featureLabelWidth(labels);
  const height = chartHeightForFeatureRows(rows.length);

  return (
    <ChartFrame theme={theme} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={horizontalBarMargin(yWidth, 4)}>
          <CartesianGrid {...cartesianGrid(theme, { horizontal: false })} />
          <XAxis {...chartXAxis(theme, "CSI value", { type: "number", tickFormatter: fmt3 })} />
          <YAxis
            {...chartYAxis(theme, undefined, {
              type: "category",
              dataKey: "feature",
              width: yWidth,
              interval: 0,
            })}
          />
          <Tooltip
            formatter={(value) => fmt3(value as number)}
            labelFormatter={(_, payload) => {
              const item = payload?.[0]?.payload as Row | undefined;
              return item?.feature ?? "";
            }}
            {...chartTooltipProps(theme)}
          />
          <Bar dataKey="csi" radius={[0, 4, 4, 0]} legendType="none" strokeWidth={theme.plot.barStrokeWidth}>
            {rows.map((entry) => (
              <Cell
                key={entry.feature}
                fill={severityColor(theme, entry.severity)}
                stroke={severityColor(theme, entry.severity)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
