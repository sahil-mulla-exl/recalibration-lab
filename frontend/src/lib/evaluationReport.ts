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
