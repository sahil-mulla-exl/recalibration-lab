import type { CSSProperties, ReactNode } from "react";

import type { TooltipProps } from "recharts";

import { CHART_DATAKEY_LABELS, chartDataKeyLabel } from "@/config/datasets";
import { EVALUATION_CHART_LABELS } from "@/config/evaluation";

import type { ChartTheme } from "@/lib/chartTheme";



type PayloadEntry = NonNullable<TooltipProps<number, string>["payload"]>[number];



type DiagnosticsChartTooltipProps = TooltipProps<number, string> & {

  theme: ChartTheme;

};



const EXTRA_LABEL_BY_KEY: Record<string, string> = {

  contribution: "CSI contribution",

  cum_pos_pct: "Cumulative positives",

  cum_neg_pct: "Cumulative negatives",

  tpr: "True positive rate",

  fpr: "False positive rate",

};



function resolveSeriesLabel(entry: PayloadEntry): string {

  const key = String(entry.dataKey ?? "");

  if (CHART_DATAKEY_LABELS[key]) return CHART_DATAKEY_LABELS[key];

  if (EVALUATION_CHART_LABELS[key]) return EVALUATION_CHART_LABELS[key];

  if (EXTRA_LABEL_BY_KEY[key]) return EXTRA_LABEL_BY_KEY[key];

  const name = String(entry.name ?? "");

  if (name && EVALUATION_CHART_LABELS[name]) return EVALUATION_CHART_LABELS[name];

  return chartDataKeyLabel(key, name || key || "Value");

}



function formatEntry(

  value: number | string | undefined,

  entry: PayloadEntry,

  formatter?: TooltipProps<number, string>["formatter"],

  index?: number,

  payload?: TooltipProps<number, string>["payload"],

): { display: ReactNode; seriesName: string } {

  const fallbackName = resolveSeriesLabel(entry);

  if (formatter && payload) {

    const out = formatter(

      value,

      String(entry.name ?? entry.dataKey ?? ""),

      entry,

      index ?? 0,

      payload,

    );

    if (Array.isArray(out)) {

      const seriesName = String(out[1] ?? "").trim() || fallbackName;

      return { display: out[0], seriesName };

    }

    return { display: out, seriesName: fallbackName };

  }

  const num = Number(value);

  const display = Number.isFinite(num) ? num.toFixed(3) : String(value ?? "—");

  return { display, seriesName: fallbackName };

}



export function DiagnosticsChartTooltip({

  active,

  payload,

  label,

  theme,

  formatter,

  labelFormatter,

}: DiagnosticsChartTooltipProps) {

  if (!active || !payload?.length) return null;



  const boxStyle: CSSProperties = {

    ...theme.tooltip.contentStyle,

    boxShadow: theme.isDark

      ? "0 10px 28px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(148, 163, 184, 0.12)"

      : "0 6px 18px rgba(15, 23, 42, 0.12)",

    padding: "10px 12px",

    minWidth: "8rem",

  };



  const labelText =

    labelFormatter && label !== undefined

      ? labelFormatter(label, payload)

      : label !== undefined && label !== null

        ? String(label)

        : null;



  return (

    <div style={boxStyle} className="recharts-diagnostics-tooltip">

      {labelText ? (

        <p

          className="mb-2 text-[11px] font-semibold leading-tight"

          style={theme.tooltip.labelStyle}

        >

          {labelText}

        </p>

      ) : null}

      <ul className="space-y-1.5">

        {payload

          .filter((entry) => entry.type !== "none")

          .map((entry, index) => {

            const color =

              (entry.color as string) ||

              (entry.payload?.fill as string) ||

              theme.series.new;

            const { display, seriesName } = formatEntry(

              entry.value as number | string | undefined,

              entry,

              formatter,

              index,

              payload,

            );

            return (

              <li

                key={`${entry.dataKey ?? entry.name}-${index}`}

                className="flex items-center justify-between gap-4 text-xs"

              >

                <span className="flex items-center gap-2 min-w-0">

                  <span

                    className="h-2.5 w-2.5 shrink-0 rounded-full"

                    style={{ backgroundColor: color }}

                    aria-hidden

                  />

                  <span style={theme.tooltip.itemStyle} className="truncate">

                    {seriesName}

                  </span>

                </span>

                <span

                  className="font-mono font-medium tabular-nums shrink-0"

                  style={theme.tooltip.itemStyle}

                >

                  {display}

                </span>

              </li>

            );

          })}

      </ul>

    </div>

  );

}

