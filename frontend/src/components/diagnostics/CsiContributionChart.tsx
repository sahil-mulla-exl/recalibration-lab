import { useMemo } from "react";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartFrame } from "@/components/diagnostics/ChartFrame";

import { chartYAxis } from "@/lib/chartAxes";

import { categoryAxisLayout } from "@/lib/chartLayout";
import {
  axisLabel,
  axisTick,
  axisTickSpacing,
  cartesianGrid,
  categoryChartMargin,
  chartTooltipProps,
  useChartTheme,
} from "@/lib/chartTheme";



type Row = { feature: string; contribution: number };

type CsiContributionChartProps = { rows: Row[] };



export function CsiContributionChart({ rows }: CsiContributionChartProps) {

  const theme = useChartTheme();

  const fmt3 = (v: number | string) => Number(v).toFixed(3);

  const featureLabels = useMemo(() => rows.map((r) => r.feature), [rows]);

  const xLayout = useMemo(() => categoryAxisLayout(featureLabels), [featureLabels]);

  const margin = useMemo(() => categoryChartMargin(xLayout.height), [xLayout.height]);



  return (

    <ChartFrame theme={theme}>

      <ResponsiveContainer width="100%" height="100%">

        <BarChart data={rows} margin={margin}>

          <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />

          <XAxis

            dataKey="feature"

            tick={{ ...axisTick(theme), dy: axisTickSpacing.x.dy }}

            tickMargin={axisTickSpacing.x.tickMargin}

            stroke={theme.axisLine}

            interval={0}

            angle={xLayout.angle}

            textAnchor={xLayout.textAnchor}

            height={xLayout.height}

            label={axisLabel(theme, "Feature", "insideBottom")}

          />

          <YAxis {...chartYAxis(theme, "CSI contribution", { tickFormatter: fmt3 })} />

          <Tooltip formatter={(value) => fmt3(value as number)} {...chartTooltipProps(theme)} />

          <Bar dataKey="contribution" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />

        </BarChart>

      </ResponsiveContainer>

    </ChartFrame>

  );

}

