import { useMemo } from "react";

import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartFrame } from "@/components/diagnostics/ChartFrame";

import { chartXAxis, chartYAxis } from "@/lib/chartAxes";

import { cartesianGrid, chartMargin, chartTooltipProps, formatChartValue, formatChartPercent, useChartTheme } from "@/lib/chartTheme";



type DecileRow = { decile: string; dev: number; current: number };

type DecileChartProps = { data: DecileRow[] };



export function DecileChart({ data }: DecileChartProps) {

  const theme = useChartTheme();

  const fmt = formatChartValue;



  const legend = useMemo(

    () => [

      { value: perfBaselineLabel(), type: "square" as const, color: theme.series.dev, dataKey: "dev" },

      { value: perfNewLabel(), type: "square" as const, color: theme.series.new, dataKey: "current" },

    ],

    [theme.series.dev, theme.series.new],

  );



  return (

    <ChartFrame theme={theme} legend={legend}>

      <ResponsiveContainer width="100%" height="100%">

        <BarChart data={data} margin={chartMargin.xyTitles} barGap={6} barCategoryGap="18%">

          <CartesianGrid {...cartesianGrid(theme, { vertical: false })} />

          <XAxis {...chartXAxis(theme, "Score decile", { dataKey: "decile" })} />

          <YAxis
            {...chartYAxis(theme, "Event rate (%)", {
              tickFormatter: (v) => formatChartPercent(v),
            })}
          />

          <Tooltip formatter={(value) => fmt(value as number)} {...chartTooltipProps(theme)} />

          <Bar dataKey="dev" fill={theme.series.devFill} stroke={theme.series.dev} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />

          <Bar dataKey="current" fill={theme.series.newFill} stroke={theme.series.new} strokeWidth={theme.plot.barStrokeWidth} legendType="none" />

        </BarChart>

      </ResponsiveContainer>

    </ChartFrame>

  );

}

