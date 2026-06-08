import { useEffect, useState } from "react";

import type { CSSProperties } from "react";

export type ChartSeverity = "stable" | "medium" | "large";

export type ChartTheme = {
  isDark: boolean;
  grid: string;
  axis: string;
  axisLine: string;
  referenceLine: string;
  tooltip: {
    contentStyle: CSSProperties;
    itemStyle: CSSProperties;
    labelStyle: CSSProperties;
  };
  legend: CSSProperties;
  series: {
    dev: string;
    devFill: string;
    new: string;
    newFill: string;
    train: string;
    trainFill: string;
    trend: string;
    barDefault: string;
    barRob: string;
    csi: string;
    csiFill: string;
  };
  plot: {
    areaFillOpacity: number;
    radarFillOpacity: number;
    barLayerOpacity: number;
    lineStrokeWidth: number;
    barStrokeWidth: number;
  };
  severity: Record<ChartSeverity, string>;
  radar: {
    grid: string;
    angleAxis: string;
  };
};

function readIsDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

const LIGHT_THEME: Omit<ChartTheme, "isDark"> = {
  grid: "rgba(15, 23, 42, 0.28)",
  axis: "#0f172a",
  axisLine: "#64748b",
  referenceLine: "#64748b",
  tooltip: {
    contentStyle: {
      backgroundColor: "#ffffff",
      border: "1px solid #cbd5e1",
      borderRadius: 8,
      color: "#0f172a",
      fontSize: 12,
    },
    itemStyle: { color: "#0f172a" },
    labelStyle: { color: "#334155", fontWeight: 600 },
  },
  legend: { color: "#0f172a", fontSize: 12 },
  series: {
    dev: "#0369a1",
    devFill: "rgba(3, 105, 161, 0.55)",
    new: "#c2410c",
    newFill: "rgba(194, 65, 12, 0.52)",
    train: "#1d4ed8",
    trainFill: "rgba(29, 78, 216, 0.5)",
    trend: "#334155",
    barDefault: "#ea580c",
    barRob: "#dc2626",
    csi: "#5b21b6",
    csiFill: "rgba(91, 33, 182, 0.62)",
  },
  plot: {
    areaFillOpacity: 0.32,
    radarFillOpacity: 0.28,
    barLayerOpacity: 1,
    lineStrokeWidth: 2.5,
    barStrokeWidth: 1.5,
  },
  severity: {
    stable: "#059669",
    medium: "#b45309",
    large: "#ea580c",
  },
  radar: {
    grid: "rgba(15, 23, 42, 0.28)",
    angleAxis: "#0f172a",
  },
};

const DARK_THEME: Omit<ChartTheme, "isDark"> = {
  grid: "rgba(148, 163, 184, 0.28)",
  axis: "#e2e8f0",
  axisLine: "#475569",
  referenceLine: "#64748b",
  tooltip: {
    contentStyle: {
      backgroundColor: "hsl(222, 47%, 18%)",
      border: "1px solid hsl(217, 33%, 32%)",
      borderRadius: 8,
      color: "#f1f5f9",
      fontSize: 12,
    },
    itemStyle: { color: "#e2e8f0" },
    labelStyle: { color: "#94a3b8", fontWeight: 600 },
  },
  legend: { color: "#e2e8f0", fontSize: 12 },
  series: {
    dev: "#38bdf8",
    devFill: "rgba(56, 189, 248, 0.35)",
    new: "#fb923c",
    newFill: "rgba(251, 146, 60, 0.35)",
    train: "#94a3b8",
    trainFill: "rgba(148, 163, 184, 0.65)",
    trend: "#f1f5f9",
    barDefault: "rgba(251, 146, 60, 0.9)",
    barRob: "rgba(248, 113, 113, 0.65)",
    csi: "#c4b5fd",
    csiFill: "rgba(167, 139, 250, 0.55)",
  },
  plot: {
    areaFillOpacity: 0.2,
    radarFillOpacity: 0.15,
    barLayerOpacity: 0.85,
    lineStrokeWidth: 2,
    barStrokeWidth: 1,
  },
  severity: {
    stable: "#34d399",
    medium: "#facc15",
    large: "#fb923c",
  },
  radar: {
    grid: "rgba(148, 163, 184, 0.35)",
    angleAxis: "#e2e8f0",
  },
};

export function useChartTheme(): ChartTheme {
  const [isDark, setIsDark] = useState(readIsDark);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(readIsDark()));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => setIsDark(readIsDark());
    mq.addEventListener("change", onMedia);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", onMedia);
    };
  }, []);

  const base = isDark ? DARK_THEME : LIGHT_THEME;
  return { isDark, ...base };
}

export function severityColor(theme: ChartTheme, severity: string): string {
  const key = severity as ChartSeverity;
  return theme.severity[key] ?? theme.series.new;
}

export function axisTick(theme: ChartTheme) {
  return { fontSize: 11, fill: theme.axis };
}

const AXIS_LABEL_OFFSET: Record<
  "insideBottom" | "insideLeft" | "insideTop" | "insideRight" | "bottom" | "left" | "right",
  number
> = {
  insideBottom: 14,
  insideLeft: 12,
  left: 6,
  insideTop: 8,
  insideRight: 12,
  bottom: 0,
  left: 0,
  right: 0,
};

export function axisLabel(
  theme: ChartTheme,
  value: string,
  position:
    | "insideBottom"
    | "insideLeft"
    | "insideTop"
    | "insideRight"
    | "left"
    | "bottom"
    | "right",
  opts?: { offset?: number; angle?: number; fontSize?: number },
) {
  const resolvedPosition =
    position === "insideBottom" || position === "bottom"
      ? ("bottom" as const)
      : position === "insideLeft" || position === "left"
        ? ("left" as const)
        : position === "insideRight" || position === "right"
          ? ("right" as const)
          : position;

  return {
    value,
    position: resolvedPosition,
    offset: opts?.offset ?? AXIS_LABEL_OFFSET[resolvedPosition],
    angle: opts?.angle,
    fontSize: opts?.fontSize ?? 10,
    fill: theme.axis,
  };
}

export const axisTickSpacing = {
  x: { tickMargin: 6, dy: 2 },
  y: { tickMargin: 6, width: 52 },
} as const;

export function cartesianGrid(
  theme: ChartTheme,
  opts?: { vertical?: boolean; horizontal?: boolean },
) {
  return {
    strokeDasharray: "3 3",
    stroke: theme.grid,
    vertical: opts?.vertical ?? true,
    horizontal: opts?.horizontal ?? true,
  };
}

export const chartMargin = {
  base: { top: 8, right: 12, left: 8, bottom: 8 },
  yTitle: { top: 8, right: 16, left: 68, bottom: 22 },
  xyTitles: { top: 8, right: 16, left: 68, bottom: 28 },
  dualAxis: { top: 8, right: 52, left: 68, bottom: 28 },
  radar: { top: 4, right: 8, bottom: 4, left: 8 },
  labeled: { top: 8, right: 16, left: 52, bottom: 26 },
  labeledLeft: { top: 8, right: 16, left: 52, bottom: 22 },
  labeledBottom: { top: 8, right: 16, left: 52, bottom: 26 },
  labeledWithLegend: { top: 8, right: 16, left: 52, bottom: 26 },
  labeledExternalLegend: { top: 8, right: 16, left: 52, bottom: 26 },
  horizontalBar: { top: 8, right: 16, left: 52, bottom: 26 },
} as const;

export function horizontalBarMargin(yAxisWidth: number, extraBottom = 0) {
  return {
    top: 8,
    right: 16,
    left: Math.max(68, Math.ceil(yAxisWidth * 0.34)),
    bottom: chartMargin.horizontalBar.bottom + extraBottom,
  };
}

export function categoryChartMargin(
  tickBandHeight: number,
  opts?: { left?: number; right?: number },
) {
  return {
    top: chartMargin.xyTitles.top,
    right: opts?.right ?? chartMargin.xyTitles.right,
    left: opts?.left ?? chartMargin.xyTitles.left,
    bottom: tickBandHeight + 22,
  };
}

/** Single-decimal formatting for chart axes, tooltips, and labels. */
export function formatChartValue(v: number | string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "—");
  return n.toFixed(1);
}

export function formatChartPercent(v: number | string): string {
  return `${formatChartValue(v)}%`;
}

export { chartTooltipProps, chartLegendProps, tooltipCursor } from "@/lib/chartTooltipProps";
