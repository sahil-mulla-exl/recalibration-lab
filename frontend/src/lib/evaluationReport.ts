import type { EvaluationCohortKey } from "@/config/evaluation";

export function cohortMetricFromReport(
  report: Record<string, unknown> | null | undefined,
  cohort: EvaluationCohortKey,
  field: string,
  legacy?: string,
): number {
  if (!report) return NaN;
  const cohorts = report.evaluation_cohorts as Record<string, Record<string, unknown>> | undefined;
  const nested = cohorts?.[cohort]?.[field];
  if (nested != null && nested !== "") {
    const n = Number(nested);
    if (Number.isFinite(n)) return n;
  }
  if (legacy) {
    const leg = report[legacy];
    if (leg != null && leg !== "") {
      const n = Number(leg);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}

/** Read a cohort metric; use `fallback` when nested and legacy values are absent. */
export function cohortMetricFromReportWithFallback(
  report: Record<string, unknown> | null | undefined,
  cohort: EvaluationCohortKey,
  field: string,
  legacy: string | undefined,
  fallback: number,
): number {
  const value = cohortMetricFromReport(report, cohort, field, legacy);
  return Number.isFinite(value) ? value : fallback;
}

export function cohortArrayFromReport<T>(
  report: Record<string, unknown> | null | undefined,
  cohort: EvaluationCohortKey,
  field: string,
  legacy?: string,
): T[] {
  if (!report) return [];
  const cohorts = report.evaluation_cohorts as Record<string, Record<string, unknown>> | undefined;
  const nested = cohorts?.[cohort]?.[field];
  if (Array.isArray(nested) && nested.length > 0) return nested as T[];
  if (legacy) {
    const leg = report[legacy];
    if (Array.isArray(leg) && leg.length > 0) return leg as T[];
  }
  return [];
}

export function cohortRocFromReport(
  report: Record<string, unknown> | null | undefined,
  cohort: EvaluationCohortKey,
  legacy?: string,
): { fpr: number[]; tpr: number[] } | undefined {
  if (!report) return undefined;
  const cohorts = report.evaluation_cohorts as Record<string, Record<string, unknown>> | undefined;
  const nested = cohorts?.[cohort]?.roc as { fpr?: number[]; tpr?: number[] } | undefined;
  if (nested?.fpr?.length) return { fpr: nested.fpr, tpr: nested.tpr ?? [] };
  if (legacy) {
    const leg = report[legacy] as { fpr?: number[]; tpr?: number[] } | undefined;
    if (leg?.fpr?.length) return { fpr: leg.fpr, tpr: leg.tpr ?? [] };
  }
  return undefined;
}

export type RocPoint = { fpr: number; tpr: number };

function ensureRocEndpoints(points: RocPoint[]): RocPoint[] {
  if (!points.length) return [
    { fpr: 0, tpr: 0 },
    { fpr: 1, tpr: 1 },
  ];
  const out = [...points];
  const first = out[0];
  if (first.fpr > 0 || first.tpr > 0) out.unshift({ fpr: 0, tpr: 0 });
  const last = out[out.length - 1];
  if (last.fpr < 1 || last.tpr < 1) out.push({ fpr: 1, tpr: 1 });
  return out;
}

/** Downsample ROC while keeping (fpr, tpr) pairs aligned and preserving endpoints. */
export function downsampleRocPoints(
  roc?: { fpr: number[]; tpr: number[] },
  target = 50,
): RocPoint[] {
  if (!roc?.fpr?.length) return [];
  const pairs: RocPoint[] = roc.fpr.map((fpr, i) => ({
    fpr: Number(fpr),
    tpr: Number(roc.tpr?.[i] ?? 0),
  }));
  if (pairs.length <= target) return ensureRocEndpoints(pairs);
  const step = Math.max(1, Math.floor(pairs.length / target));
  const sampled = pairs.filter((_, i) => i % step === 0);
  return ensureRocEndpoints(sampled);
}

function interpolateRocTpr(points: RocPoint[], fpr: number): number | null {
  if (!points.length) return null;
  if (fpr <= points[0].fpr) return points[0].tpr;
  const last = points[points.length - 1];
  if (fpr >= last.fpr) return last.tpr;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (fpr <= curr.fpr) {
      const span = curr.fpr - prev.fpr;
      if (span <= 0) return curr.tpr;
      const weight = (fpr - prev.fpr) / span;
      return prev.tpr + weight * (curr.tpr - prev.tpr);
    }
  }
  return last.tpr;
}

/** Merge multiple ROC series on a shared false-positive-rate grid (avoids index misalignment). */
export function mergeRocSeriesForChart(
  series: Array<{ key: string; points: RocPoint[] }>,
): Array<Record<string, number | null>> {
  const fprSet = new Set<number>([0, 1]);
  for (const entry of series) {
    for (const point of entry.points) {
      if (Number.isFinite(point.fpr)) fprSet.add(point.fpr);
    }
  }
  const fprs = [...fprSet].sort((a, b) => a - b);
  return fprs.map((fpr) => {
    const row: Record<string, number | null> = { fpr };
    for (const entry of series) {
      row[entry.key] = interpolateRocTpr(entry.points, fpr);
    }
    return row;
  });
}
