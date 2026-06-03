import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { buildKsCdfSeries, type KsCurvePoint } from "@/lib/ksCurve";
import { cartesianGrid, chartMargin, useChartTheme } from "@/lib/chartTheme";
import type { ChartTheme } from "@/lib/chartTheme";

export type EvaluationKsCohortSeries = {
  key: string;
  label: string;
  color: string;
  points: KsCurvePoint[];
};

type EvaluationKsChartProps = {
  cohorts: EvaluationKsCohortSeries[];
  height?: number;
};

type TooltipPayloadEntry = NonNullable<TooltipProps<number, string>["payload"]>[number];

function fmtPct(v: number | string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function ksCohortLineName(cohortLabel: string, kind: "events" | "nonEvents") {
  return kind === "events"
    ? `${cohortLabel} · Cum. % events`
    : `${cohortLabel} · Cum. % non-events`;
}

function resolveLineLabel(entry: TooltipPayloadEntry, cohortByKey: Map<string, EvaluationKsCohortSeries>) {
  const explicit = String(entry.name ?? "").trim();
  if (explicit && !explicit.includes("_cum")) return explicit;

  const dataKey = String(entry.dataKey ?? "");
  const match = dataKey.match(/^(.+)_(cumPos|cumNeg)$/);
  if (match) {
    const cohort = cohortByKey.get(match[1]);
    if (cohort) {
      return ksCohortLineName(cohort.label, match[2] === "cumPos" ? "events" : "nonEvents");
    }
  }
  return explicit || dataKey || "Value";
}

function cohortSortIndex(dataKey: string, cohorts: EvaluationKsCohortSeries[]) {
  const base = dataKey.replace(/_cumPos$|_cumNeg$/, "");
  const cohortIdx = cohorts.findIndex((c) => c.key === base);
  const lineIdx = dataKey.endsWith("_cumNeg") ? 1 : 0;
  return cohortIdx * 2 + lineIdx;
}

function EvaluationKsTooltip({
  active,
  payload,
  label,
  theme,
  cohorts,
}: TooltipProps<number, string> & {
  theme: ChartTheme;
  cohorts: EvaluationKsCohortSeries[];
}) {
  if (!active || !payload?.length) return null;

  const cohortByKey = new Map(cohorts.map((c) => [c.key, c]));
  const row = payload[0]?.payload as { population_pct?: number } | undefined;
  const population =
    row?.population_pct ??
    (typeof label === "number" && Number.isFinite(label) ? label : Number(label));

  const entries = [...payload]
    .filter((entry) => entry.value != null && Number.isFinite(Number(entry.value)))
    .sort(
      (a, b) =>
        cohortSortIndex(String(a.dataKey ?? ""), cohorts) - cohortSortIndex(String(b.dataKey ?? ""), cohorts),
    );

  return (
    <div className="rounded-lg px-3 py-2.5 text-xs shadow-md min-w-[240px]" style={theme.tooltip.contentStyle}>
      <p className="font-semibold mb-2" style={theme.tooltip.labelStyle}>
        Population scored: {fmtPct(population)}
      </p>
      <ul className="space-y-1.5">
        {entries.map((entry) => {
          const seriesLabel = resolveLineLabel(entry, cohortByKey);
          const color = entry.color ?? entry.stroke ?? theme.axis;
          return (
            <li key={`${entry.dataKey}-${seriesLabel}`} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: typeof color === "string" ? color : theme.axis }}
                />
                <span className="leading-snug">{seriesLabel}</span>
              </span>
              <span className="font-mono tabular-nums shrink-0" style={theme.tooltip.itemStyle}>
                {fmtPct(entry.value as number)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function EvaluationKsChart({ cohorts, height }: EvaluationKsChartProps) {
  const theme = useChartTheme();

  const data = useMemo(
    () => buildKsCdfSeries(cohorts.map((c) => ({ key: c.key, points: c.points }))),
    [cohorts],
  );

  const legend = useMemo(
    () =>
      cohorts.map((c) => ({
        value: c.label,
        type: "line" as const,
        color: c.color,
      })),
    [cohorts],
  );

  if (!cohorts.length || !data.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No KS curve data available.</p>;
  }

  return (
    <ChartFrame theme={theme} height={height} legend={legend}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={chartMargin.xyTitles}>
          <CartesianGrid {...cartesianGrid(theme)} />
          <XAxis
            {...chartXAxis(theme, "Population (%)", {
              dataKey: "population_pct",
              type: "number",
              domain: [0, 100],
              tickFormatter: (v) => fmtPct(v),
            })}
          />
          <YAxis
            {...chartYAxis(theme, "Cumulative rate (%)", {
              type: "number",
              domain: [0, 100] as [number, number],
              tickFormatter: (v) => fmtPct(v),
            })}
          />
          <Tooltip
            cursor={{ stroke: theme.axisLine, strokeWidth: 1 }}
            content={(props) => (
              <EvaluationKsTooltip {...props} theme={theme} cohorts={cohorts} />
            )}
          />
          {cohorts.map((c) => (
            <KsCohortLines key={c.key} theme={theme} cohortKey={c.key} cohortLabel={c.label} color={c.color} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function KsCohortLines({
  theme,
  cohortKey,
  cohortLabel,
  color,
}: {
  theme: ChartTheme;
  cohortKey: string;
  cohortLabel: string;
  color: string;
}) {
  return (
    <>
      <Line
        type="monotone"
        dataKey={`${cohortKey}_cumPos`}
        name={ksCohortLineName(cohortLabel, "events")}
        stroke={color}
        strokeWidth={theme.plot.lineStrokeWidth}
        dot={false}
        legendType="none"
      />
      <Line
        type="monotone"
        dataKey={`${cohortKey}_cumNeg`}
        name={ksCohortLineName(cohortLabel, "nonEvents")}
        stroke={color}
        strokeWidth={theme.plot.lineStrokeWidth}
        strokeDasharray="6 4"
        dot={false}
        legendType="none"
      />
    </>
  );
}
