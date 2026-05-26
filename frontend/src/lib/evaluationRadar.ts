export type RadarMetricSpec = {
  axis: string;
  hold: number;
  oos: number;
  recal: number;
  higherIsBetter?: boolean;
  format?: (v: number) => string;
};

export type RadarChartRow = {
  axis: string;
  championHold: number;
  championOos: number;
  recalibratedOos: number;
  rawHold: number;
  rawOos: number;
  rawRecal: number;
  format: (v: number) => string;
};

function scaleHigherBetter(values: [number, number, number]): [number, number, number] {
  const max = Math.max(...values, 1e-9);
  return values.map((v) => (Math.min(Math.max(v / max, 0), 1) * 100)) as [number, number, number];
}

function scaleLowerBetter(values: [number, number, number]): [number, number, number] {
  const max = Math.max(...values, 1e-9);
  return values.map((v) => (Math.min(Math.max(1 - v / max, 0), 1) * 100)) as [number, number, number];
}

/** Build radar rows: normalized 0–100 per axis using the same raw values as metric cards. */
export function buildEvaluationRadarRows(metrics: RadarMetricSpec[]): RadarChartRow[] {
  return metrics.map((m) => {
    const triple: [number, number, number] = [m.hold, m.oos, m.recal];
    const [holdN, oosN, recalN] = m.higherIsBetter === false
      ? scaleLowerBetter(triple)
      : scaleHigherBetter(triple);
    const format = m.format ?? ((v: number) => v.toFixed(4));

    return {
      axis: m.axis,
      championHold: holdN,
      championOos: oosN,
      recalibratedOos: recalN,
      rawHold: m.hold,
      rawOos: m.oos,
      rawRecal: m.recal,
      format,
    };
  });
}
