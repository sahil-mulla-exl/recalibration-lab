/** Standard plot height inside diagnostics / evaluation cards (px). */
export const CARD_CHART_HEIGHT = 340;
export const CARD_CHART_HEIGHT_RADAR = 400;

/** Layout helpers for horizontal feature bar charts (IV, AUC, SHAP). */

export function featureLabelWidth(features: string[]): number {  if (features.length === 0) return 160;
  const longest = Math.max(...features.map((f) => String(f).length));
  return Math.min(200, Math.max(112, longest * 6));
}

export function chartHeightForFeatureRows(rowCount: number, rowHeight = 30): number {
  const n = Math.max(rowCount, 1);
  return Math.min(720, Math.max(220, n * rowHeight + 56));
}

/** Convert a rate that may be a fraction (0.095) or percent (9.5) to percent for charts. */
export function rateToPercent(rate: number): number {
  const r = Number(rate);
  if (!Number.isFinite(r)) return 0;
  return Math.abs(r) <= 1 ? r * 100 : r;
}

/** Bottom space for category axis ticks (Recharts XAxis height + margin padding). */
export function categoryAxisLayout(
  labels: string[],
  opts?: { angleThreshold?: number; longLabelChars?: number },
) {
  const count = labels.length;
  const maxLen = labels.reduce((m, s) => Math.max(m, String(s).length), 0);
  const angleThreshold = opts?.angleThreshold ?? 10;
  const longLabelChars = opts?.longLabelChars ?? 14;
  const angled = count > angleThreshold || maxLen > longLabelChars;
  const height = angled ? 44 : 28;
  return {
    angled,
    height,
    angle: angled ? -25 : 0,
    textAnchor: angled ? ("end" as const) : ("middle" as const),
    /** Space for angled ticks plus X-axis title below */
    marginBottom: height + 20,
  };
}

export function buildPercentTicks(maxPct: number): number[] {
  const ceiling = Math.max(5, Math.ceil(maxPct / 5) * 5);
  const step = ceiling <= 15 ? 2 : ceiling <= 40 ? 5 : 10;
  const ticks: number[] = [];
  for (let v = 0; v <= ceiling; v += step) {
    ticks.push(v);
  }
  if (ticks[ticks.length - 1] !== ceiling) {
    ticks.push(ceiling);
  }
  return ticks;
}
