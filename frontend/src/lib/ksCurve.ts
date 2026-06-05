export type KsCurvePoint = {
  population_pct: number;
  ks?: number;
  cum_pos_pct?: number;
  cum_neg_pct?: number;
};

export type KsChartPoint = {
  population_pct: number;
  cum_pos_pct: number;
  cum_neg_pct: number;
  ks?: number;
};

/** Normalize KS curve points for the diagnostics `KsChart` (0–100 population and cumulative rates). */
export function toKsChartData(points: KsCurvePoint[]): KsChartPoint[] {
  if (!points.length) return [];
  const maxPop = Math.max(...points.map((p) => Number(p.population_pct) || 0));
  const popScale = maxPop > 0 && maxPop <= 1.01 ? 100 : 1;
  const maxCum = Math.max(
    ...points.flatMap((p) => [Number(p.cum_pos_pct ?? 0), Number(p.cum_neg_pct ?? 0), Number(p.ks ?? 0)]),
  );
  const cumScale = maxCum > 0 && maxCum <= 1.01 ? 100 : 1;
  const ksScale = cumScale === 1 && maxCum > 1.01 ? 100 : cumScale;
  return [...points]
    .sort((a, b) => a.population_pct - b.population_pct)
    .map((p) => ({
      population_pct: Number(p.population_pct) * popScale,
      cum_pos_pct: Number(p.cum_pos_pct ?? 0) * cumScale,
      cum_neg_pct: Number(p.cum_neg_pct ?? 0) * cumScale,
      ks: Number(p.ks ?? 0) * ksScale,
    }));
}

/** Population % at maximum KS separation (for vertical reference line). */
function ksSeparationAtPoint(p: KsChartPoint): number {
  const fromKs = Number(p.ks ?? 0);
  const fromCum = Math.abs(Number(p.cum_pos_pct ?? 0) - Number(p.cum_neg_pct ?? 0));
  return Math.max(fromKs, fromCum);
}

export function ksMaxPopulationPct(data: KsChartPoint[]): number | undefined {
  if (!data.length) return undefined;
  let bestKs = -1;
  let pop = 0;
  for (const p of data) {
    const ks = ksSeparationAtPoint(p);
    if (ks > bestKs) {
      bestKs = ks;
      pop = Number(p.population_pct);
    }
  }
  return bestKs >= 0 ? pop : undefined;
}

/** Maximum KS separation across curve points (same scale as chart data). */
export function maxKsFromChartData(data: KsChartPoint[]): number | undefined {
  if (!data.length) return undefined;
  const values = data.map((p) => ksSeparationAtPoint(p)).filter((v) => Number.isFinite(v));
  if (!values.length) return undefined;
  return Math.max(...values);
}

function fieldValue(point: KsCurvePoint, field: keyof Pick<KsCurvePoint, "ks" | "cum_pos_pct" | "cum_neg_pct">): number {
  return Number(point[field] ?? 0);
}

export function interpolateKsField(
  points: KsCurvePoint[],
  populationPct: number,
  field: keyof Pick<KsCurvePoint, "ks" | "cum_pos_pct" | "cum_neg_pct">,
): number {
  if (!points.length) return 0;
  const sorted = [...points].sort((a, b) => a.population_pct - b.population_pct);
  if (populationPct <= sorted[0].population_pct) return fieldValue(sorted[0], field);
  if (populationPct >= sorted[sorted.length - 1].population_pct) {
    return fieldValue(sorted[sorted.length - 1], field);
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const hi = sorted[i];
    const lo = sorted[i - 1];
    if (populationPct <= hi.population_pct) {
      const span = hi.population_pct - lo.population_pct;
      const t = span > 0 ? (populationPct - lo.population_pct) / span : 0;
      return fieldValue(lo, field) + t * (fieldValue(hi, field) - fieldValue(lo, field));
    }
  }
  return 0;
}

/** Align KS statistic curves on a shared population-% grid. */
export function buildAlignedKsSeries(
  series: { key: string; points: KsCurvePoint[] }[],
  options?: { field?: "ks" | "cum_pos_pct" | "cum_neg_pct"; scaleToPercent?: boolean },
): Array<Record<string, number>> {
  const field = options?.field ?? "ks";
  const scale = options?.scaleToPercent ?? true;
  const grid = new Set<number>();
  series.forEach((s) => s.points.forEach((p) => grid.add(p.population_pct)));
  const sortedGrid = [...grid].sort((a, b) => a - b);
  return sortedGrid.map((population_pct) => {
    const row: Record<string, number> = { population_pct };
    series.forEach(({ key, points }) => {
      const raw = interpolateKsField(points, population_pct, field);
      row[key] = scale && field === "ks" ? raw * 100 : raw;
    });
    return row;
  });
}

/** Cumulative good/bad distributions for classic KS plot (MIDAS-style). */
export function buildKsCdfSeries(
  series: { key: string; points: KsCurvePoint[] }[],
): Array<Record<string, number>> {
  const grid = new Set<number>();
  series.forEach((s) => s.points.forEach((p) => grid.add(p.population_pct)));
  const sortedGrid = [...grid].sort((a, b) => a - b);
  return sortedGrid.map((population_pct) => {
    const row: Record<string, number> = { population_pct };
    series.forEach(({ key, points }) => {
      row[`${key}_cumPos`] = interpolateKsField(points, population_pct, "cum_pos_pct");
      row[`${key}_cumNeg`] = interpolateKsField(points, population_pct, "cum_neg_pct");
    });
    return row;
  });
}
