import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "@/components/charts";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { CARD_CHART_HEIGHT } from "@/lib/chartLayout";
import {
  EVALUATION_DATA_KEYS,
  EVALUATION_SERIES,
} from "@/config/evaluation";
import {
  cartesianGrid,
  chartMargin,
  chartTooltipProps,
  type ChartTheme,
} from "@/lib/chartTheme";

type EvaluationCohortKey = "champion_hold" | "champion_oos" | "recalibrated_oos";

export type RankOrderDecileRow = {
  decile: number;
  count: number;
  events: number;
  non_events: number;
  event_rate: number;
  avg_score: number;
  lift: number;
  cum_event_rate: number;
};

export type RankOrderBreakSummary = {
  non_decreasing_count?: number;
  total_transitions?: number;
  break_indices?: number[];
  monotonicity_violations?: Array<{ from_decile: number; to_decile: number }>;
};

type RobCohortConfig = {
  cohort: EvaluationCohortKey;
  label: string;
  dataKey: string;
  legacyRobKey: string;
  legacyDecilesKey: string;
};

const ROB_COHORTS: RobCohortConfig[] = [
  {
    cohort: "champion_hold",
    label: EVALUATION_SERIES.championHold,
    dataKey: EVALUATION_DATA_KEYS.championHold,
    legacyRobKey: "champion_hold_rank_order_break",
    legacyDecilesKey: "champion_hold_rank_order_deciles",
  },
  {
    cohort: "champion_oos",
    label: EVALUATION_SERIES.championOos,
    dataKey: EVALUATION_DATA_KEYS.championOos,
    legacyRobKey: "champion_oos_rank_order_break",
    legacyDecilesKey: "champion_oos_rank_order_deciles",
  },
  {
    cohort: "recalibrated_oos",
    label: EVALUATION_SERIES.recalibratedOos,
    dataKey: EVALUATION_DATA_KEYS.recalibratedOos,
    legacyRobKey: "recalibrated_oos_rank_order_break",
    legacyDecilesKey: "recalibrated_oos_rank_order_deciles",
  },
];

function formatPct(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatNum(value?: number | null, digits = 3): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatLift(lift: number): string {
  if (!Number.isFinite(lift)) return "—";
  return `${lift.toFixed(2)}x`;
}

function monotonicityCount(deciles: RankOrderDecileRow[], violationsCount: number) {
  const total = Math.max(0, deciles.length - 1);
  const ok = Math.max(0, total - Math.max(0, violationsCount));
  return { ok, total };
}

function monotonicityBadgeClass(ok: number, total: number): string {
  if (total <= 0) return "bg-muted text-muted-foreground border-border";
  if (ok >= 9 && total >= 9) return "bg-emerald-500/15 text-emerald-800 border-emerald-500/35 dark:text-emerald-200";
  if (ok >= 7) return "bg-amber-500/15 text-amber-900 border-amber-500/35 dark:text-amber-200";
  return "bg-red-500/15 text-red-800 border-red-500/35 dark:text-red-200";
}

function rankOrderSummary(deciles: RankOrderDecileRow[], violationsCount: number): string {
  const total = Math.max(0, deciles.length - 1);
  const ok = total - violationsCount;
  if (total <= 0) return "";
  if (violationsCount === 0) return `${ok} of ${total} transitions monotonic. No rank-order breaks.`;
  const v = violationsCount === 1 ? "1 break" : `${violationsCount} breaks`;
  return `${ok} of ${total} transitions monotonic. ${v}.`;
}

function rowStatus(deciles: RankOrderDecileRow[], idx: number): "pass" | "fail" {
  if (idx === 0) return "pass";
  const prev = deciles[idx - 1];
  const row = deciles[idx];
  return (row.event_rate ?? 0) >= (prev.event_rate ?? 0) ? "pass" : "fail";
}

function robFromReport(report: Record<string, unknown>, cohort: EvaluationCohortKey, legacyKey: string): RankOrderBreakSummary {
  const cohorts = report.evaluation_cohorts as Record<string, Record<string, unknown>> | undefined;
  const nested = cohorts?.[cohort]?.rank_order_break;
  if (nested && typeof nested === "object") return nested as RankOrderBreakSummary;
  const legacy = report[legacyKey];
  return legacy && typeof legacy === "object" ? (legacy as RankOrderBreakSummary) : {};
}

function decilesFromReport(
  report: Record<string, unknown>,
  cohort: EvaluationCohortKey,
  legacyKey: string,
): RankOrderDecileRow[] {
  const cohorts = report.evaluation_cohorts as Record<string, Record<string, unknown>> | undefined;
  const nested = cohorts?.[cohort]?.rank_order_deciles;
  if (Array.isArray(nested) && nested.length > 0) {
    return nested as RankOrderDecileRow[];
  }
  const legacy = report[legacyKey];
  return Array.isArray(legacy) ? (legacy as RankOrderDecileRow[]) : [];
}

function cohortRowCount(report: Record<string, unknown>, cohort: EvaluationCohortKey): number {
  const cohorts = report.evaluation_cohorts as Record<string, Record<string, unknown>> | undefined;
  return Number(cohorts?.[cohort]?.rows ?? 0);
}

type EvaluationRankOrderBreakProps = {
  report: Record<string, unknown>;
  theme: ChartTheme;
  cohortColors: Record<string, string>;
};

export function EvaluationRankOrderBreak({ report, theme, cohortColors }: EvaluationRankOrderBreakProps) {
  const cohortData = useMemo(
    () =>
      ROB_COHORTS.map((cfg) => {
        const deciles = decilesFromReport(report, cfg.cohort, cfg.legacyDecilesKey);
        const rob = robFromReport(report, cfg.cohort, cfg.legacyRobKey);
        const violations = rob.monotonicity_violations ?? [];
        return {
          ...cfg,
          color: cohortColors[cfg.dataKey] ?? theme.series.train,
          deciles,
          rob,
          violations,
          rowCount: cohortRowCount(report, cfg.cohort),
        };
      }),
    [report, cohortColors, theme.series.train],
  );

  const [selectedKey, setSelectedKey] = useState(ROB_COHORTS[0].dataKey);
  const selected = cohortData.find((c) => c.dataKey === selectedKey) ?? cohortData[0];

  const eventRateChartData = useMemo(() => {
    if (!selected?.deciles.length) return [];
    const violationDeciles = new Set<number>();
    selected.violations.forEach((v) => {
      violationDeciles.add(Number(v.from_decile));
      violationDeciles.add(Number(v.to_decile));
    });
    return selected.deciles.map((row) => ({
      label: `D${row.decile}`,
      eventRatePct: (row.event_rate ?? 0) * 100,
      isRob:
        violationDeciles.has(row.decile) ||
        selected.violations.some(
          (v) => Number(v.from_decile) === row.decile || Number(v.to_decile) === row.decile,
        ),
    }));
  }, [selected]);

  const violationPairs = useMemo(() => {
    const pairs = new Set<string>();
    selected?.violations.forEach((v) => pairs.add(`${Number(v.from_decile)}-${Number(v.to_decile)}`));
    return pairs;
  }, [selected?.violations]);

  if (!cohortData.some((c) => c.deciles.length > 0 || (c.rob.total_transitions ?? 0) > 0)) {
    return (
      <ChartCard
        title="Rank order break"
        subtitle="Monotonic decile event-rate transitions (decile 1 = lowest score)"
        className="w-full"
      >
        <p className="text-sm text-muted-foreground py-2">
          Re-run the Evaluation agent to populate rank-order decile analysis for all three cohorts.
        </p>
      </ChartCard>
    );
  }

  const { ok, total } = monotonicityCount(selected.deciles, selected.violations.length);

  return (
    <ChartCard
      title="Rank order break"
      subtitle="Monotonic decile event-rate transitions (decile 1 = lowest score / lowest risk)"
      className="w-full"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {cohortData.map((c) => {
            const { ok: cOk, total: cTotal } = monotonicityCount(c.deciles, c.violations.length);
            const nViol = c.violations.length;
            const breakHint =
              nViol > 0 && c.violations[0]
                ? `Break at D${c.violations[0].from_decile} → D${c.violations[0].to_decile}.`
                : "No breaks.";
            return (
              <button
                key={c.dataKey}
                type="button"
                onClick={() => setSelectedKey(c.dataKey)}
                className={`text-left rounded-xl border-2 p-4 transition-all hover:shadow-sm ${
                  selectedKey === c.dataKey
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/20"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
                  <span className="leading-tight">{c.label}</span>
                </div>
                {c.rowCount > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">{c.rowCount.toLocaleString()} records</p>
                )}
                <div
                  className={`mt-2 inline-flex rounded-lg px-2 py-1 border text-base font-bold tabular-nums ${monotonicityBadgeClass(
                    cOk,
                    cTotal,
                  )}`}
                >
                  {cTotal > 0 ? `${cOk}/${cTotal}` : "—"}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {cTotal > 0
                    ? `${cOk}/${cTotal} monotonic transitions. ${nViol ? breakHint : "No breaks."}`
                    : "No decile snapshot available."}
                </p>
              </button>
            );
          })}
        </div>

        {selected.deciles.length > 0 ? (
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-5">
            <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: selected.color }} />
              <span className="text-base font-semibold text-foreground">{selected.label}</span>
              <span
                className={`ml-auto text-xs font-bold rounded-lg px-2 py-1 border ${monotonicityBadgeClass(ok, total)}`}
              >
                Monotonicity: {ok}/{total}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-lg px-3 py-1.5 text-sm font-bold border ${monotonicityBadgeClass(ok, total)}`}>
                {ok}/{total}
              </span>
              <span className="text-sm text-muted-foreground">
                {rankOrderSummary(selected.deciles, selected.violations.length)}
              </span>
            </div>

            <div>
              <div className="text-sm font-semibold text-foreground mb-1">Event rate by decile</div>
              <p className="text-xs text-muted-foreground mb-2">Red bars mark rank-order break (ROB) deciles.</p>
              <ChartFrame theme={theme} height={CARD_CHART_HEIGHT}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={eventRateChartData} margin={chartMargin.xyTitles}>
                    <CartesianGrid {...cartesianGrid(theme)} />
                    <XAxis {...chartXAxis(theme, "Decile (1 = lowest risk)", { dataKey: "label" })} />
                    <YAxis
                      {...chartYAxis(theme, "Event rate (%)", {
                        tickFormatter: (v) => `${Number(v).toFixed(1)}%`,
                      })}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${Number(v).toFixed(2)}%`, "Event rate"]}
                      {...chartTooltipProps(theme)}
                    />
                    <Bar dataKey="eventRatePct" radius={[4, 4, 0, 0]} legendType="none">
                      {eventRateChartData.map((e, i) => (
                        <Cell
                          key={i}
                          fill={e.isRob ? theme.series.barRob : theme.series.newFill}
                          stroke={e.isRob ? theme.series.barRob : theme.series.new}
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone"
                      dataKey="eventRatePct"
                      stroke={theme.series.trend}
                      strokeWidth={2}
                      dot={{ r: 3, fill: theme.series.trend }}
                      legendType="none"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>

            <div>
              <div className="text-sm font-semibold text-foreground mb-2">Decile analysis</div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {[
                        "Decile",
                        "Count",
                        "Events",
                        "Non-events",
                        "Event rate",
                        "Avg score",
                        "Lift",
                        "Cum event rate",
                        "Status",
                      ].map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selected.deciles.map((row, idx) => {
                      const st = rowStatus(selected.deciles, idx);
                      const robPair = violationPairs.has(
                        `${Number(selected.deciles[idx - 1]?.decile)}-${Number(row.decile)}`,
                      );
                      const highlight =
                        st === "fail" ||
                        robPair ||
                        selected.violations.some(
                          (v) => Number(v.from_decile) === row.decile || Number(v.to_decile) === row.decile,
                        );
                      const topDecile = row.decile === selected.deciles[selected.deciles.length - 1]?.decile;
                      return (
                        <tr key={row.decile} className={highlight ? "bg-red-500/10" : "hover:bg-muted/30"}>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">
                            {row.decile}
                            {st === "fail" ? " ▼ ROB" : ""}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{row.count}</td>
                          <td className="px-3 py-2 tabular-nums">{row.events}</td>
                          <td className="px-3 py-2 tabular-nums">{row.non_events}</td>
                          <td
                            className={`px-3 py-2 tabular-nums ${
                              topDecile ? "text-orange-600 dark:text-orange-400 font-semibold" : ""
                            }`}
                          >
                            {formatPct(row.event_rate)}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{formatNum(row.avg_score, 4)}</td>
                          <td
                            className={`px-3 py-2 tabular-nums ${
                              topDecile ? "text-orange-600 dark:text-orange-400 font-semibold" : ""
                            }`}
                          >
                            {formatLift(row.lift)}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{formatPct(row.cum_event_rate)}</td>
                          <td className="px-3 py-2">
                            {st === "fail" ? (
                              <span className="text-red-600 dark:text-red-400 font-bold">✗</span>
                            ) : (
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg p-3">
            No decile table for {selected.label}. Re-run the Evaluation agent to refresh rank-order analysis.
          </p>
        )}
      </div>
    </ChartCard>
  );
}
