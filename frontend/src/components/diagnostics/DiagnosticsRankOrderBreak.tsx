import { useMemo } from "react";
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
import { ChartCard } from "@/components/diagnostics/ChartCard";
import { ChartFrame } from "@/components/diagnostics/ChartFrame";
import { chartXAxis, chartYAxis } from "@/lib/chartAxes";
import { CARD_CHART_HEIGHT } from "@/lib/chartLayout";
import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import { cartesianGrid, chartMargin, chartTooltipProps, useChartTheme } from "@/lib/chartTheme";

type RobSummary = {
  non_decreasing_count?: number;
  total_transitions?: number;
  monotonicity_violations?: Array<{ from_decile: number; to_decile: number }>;
};

function robSummaryText(rob: RobSummary): string {
  const total = Number(rob.total_transitions ?? 0);
  const violations = rob.monotonicity_violations ?? [];
  const ok = Math.max(0, total - violations.length);
  if (total <= 0) return "No decile transitions available.";
  if (violations.length === 0) return `${ok} of ${total} transitions monotonic. No rank-order breaks.`;
  const v = violations.length === 1 ? "1 break" : `${violations.length} breaks`;
  return `${ok} of ${total} transitions monotonic. ${v}.`;
}

function monotonicityBadgeClass(ok: number, total: number): string {
  if (total <= 0) return "bg-muted text-muted-foreground border-border";
  if (ok >= 9 && total >= 9) return "bg-emerald-500/15 text-emerald-800 border-emerald-500/35 dark:text-emerald-200";
  if (ok >= 7) return "bg-amber-500/15 text-amber-900 border-amber-500/35 dark:text-amber-200";
  return "bg-red-500/15 text-red-800 border-red-500/35 dark:text-red-200";
}

type DiagnosticsRankOrderBreakProps = {
  perf: Record<string, unknown>;
};

export function DiagnosticsRankOrderBreak({ perf }: DiagnosticsRankOrderBreakProps) {
  const theme = useChartTheme();
  const robDev = (perf.rob_dev ?? {}) as RobSummary;
  const robNew = (perf.rob_new ?? {}) as RobSummary;
  const devRates = (perf.decile_rates_dev ?? []) as number[];
  const newRates = (perf.decile_rates_new ?? []) as number[];

  const hasRob =
    (robDev.total_transitions ?? 0) > 0 ||
    (robNew.total_transitions ?? 0) > 0 ||
    devRates.length > 0 ||
    newRates.length > 0;

  const chartData = useMemo(() => {
    const violationDeciles = new Set<number>();
    (robNew.monotonicity_violations ?? []).forEach((v) => {
      violationDeciles.add(Number(v.from_decile));
      violationDeciles.add(Number(v.to_decile));
    });
    const len = Math.max(devRates.length, newRates.length);
    return Array.from({ length: len }).map((_, idx) => {
      const decile = idx + 1;
      return {
        label: `D${decile}`,
        dev: Number(devRates[idx] ?? 0),
        current: Number(newRates[idx] ?? 0),
        isRob: violationDeciles.has(decile),
      };
    });
  }, [devRates, newRates, robNew.monotonicity_violations]);

  if (!hasRob) {
    return (
      <ChartCard
        title="Rank order break"
        subtitle="Monotonic decile event-rate transitions (decile 1 = lowest score)"
        className="w-full"
      >
        <p className="text-sm text-muted-foreground py-2">
          Re-run the Diagnostics agent to populate rank-order analysis.
        </p>
      </ChartCard>
    );
  }

  const devViolations = robDev.monotonicity_violations?.length ?? 0;
  const newViolations = robNew.monotonicity_violations?.length ?? 0;
  const devTotal = Number(robDev.total_transitions ?? 0);
  const newTotal = Number(robNew.total_transitions ?? 0);
  const devOk = Math.max(0, devTotal - devViolations);
  const newOk = Math.max(0, newTotal - newViolations);

  return (
    <ChartCard
      title="Rank order break"
      subtitle="Monotonic decile event-rate transitions (decile 1 = lowest score)"
      className="w-full"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{perfBaselineLabel()}</p>
          <span
            className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${monotonicityBadgeClass(devOk, devTotal)}`}
          >
            {devOk}/{devTotal} monotonic
          </span>
          <p className="text-xs text-muted-foreground">{robSummaryText(robDev)}</p>
        </div>
        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{perfNewLabel()}</p>
          <span
            className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${monotonicityBadgeClass(newOk, newTotal)}`}
          >
            {newOk}/{newTotal} monotonic
          </span>
          <p className="text-xs text-muted-foreground">{robSummaryText(robNew)}</p>
        </div>
      </div>

      {chartData.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            Red bars mark rank-order break (ROB) deciles on {perfNewLabel()}.
          </p>
          <ChartFrame
            theme={theme}
            height={CARD_CHART_HEIGHT}
            legend={[
              { value: perfBaselineLabel(), type: "line", color: theme.series.dev, dataKey: "dev" },
              { value: perfNewLabel(), type: "line", color: theme.series.new, dataKey: "current" },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={chartMargin.xyTitles}>
                <CartesianGrid {...cartesianGrid(theme)} />
                <XAxis {...chartXAxis(theme, "Decile", { dataKey: "label" })} />
                <YAxis {...chartYAxis(theme, "Event rate (%)", {})} />
                <Tooltip {...chartTooltipProps(theme)} />
                <Bar dataKey="current" radius={[3, 3, 0, 0]} legendType="none">
                  {chartData.map((row) => (
                    <Cell
                      key={row.label}
                      fill={row.isRob ? theme.series.new : theme.series.newFill}
                      stroke={theme.series.new}
                      strokeWidth={row.isRob ? 2 : 1}
                    />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="dev"
                  stroke={theme.series.dev}
                  strokeWidth={theme.plot.lineStrokeWidth}
                  dot={false}
                  legendType="none"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </>
      )}
    </ChartCard>
  );
}
