import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export type ChartTheme = {
  isDark: boolean;
  grid: string;
  axis: string;
  axisLine: string;
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
  };
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
  grid: "rgba(15, 23, 42, 0.18)",
  axis: "#0f172a",
  axisLine: "#94a3b8",
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
    dev: "#004d6b",
    devFill: "rgba(0, 77, 107, 0.2)",
    new: "#9a3412",
    newFill: "rgba(154, 52, 18, 0.22)",
    train: "#475569",
    trainFill: "rgba(71, 85, 105, 0.18)",
    trend: "#1e293b",
    barDefault: "rgba(154, 52, 18, 0.85)",
    barRob: "rgba(185, 28, 28, 0.75)",
  },
  radar: {
    grid: "rgba(15, 23, 42, 0.22)",
    angleAxis: "#0f172a",
  },
};

const DARK_THEME: Omit<ChartTheme, "isDark"> = {
  grid: "rgba(148, 163, 184, 0.28)",
  axis: "#e2e8f0",
  axisLine: "#475569",
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

export function axisTick(theme: ChartTheme) {
  return { fontSize: 11, fill: theme.axis };
}

/** Axis title (XAxis/YAxis label prop) with theme-aware fill */
export function axisLabel(
  theme: ChartTheme,
  value: string,
  position: "insideBottom" | "insideLeft" | "insideTop" | "insideRight",
  opts?: { offset?: number; angle?: number; fontSize?: number },
) {
  return {
    value,
    position,
    offset: opts?.offset ?? -2,
    angle: opts?.angle,
    fontSize: opts?.fontSize ?? 10,
    fill: theme.axis,
  };
}

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

/** Extra margin so axis titles are not clipped. */
export const chartMargin = {
  base: { top: 8, right: 16, left: 8, bottom: 8 },
  labeled: { top: 12, right: 16, left: 12, bottom: 36 },
  labeledLeft: { top: 12, right: 16, left: 56, bottom: 36 },
  labeledBottom: { top: 12, right: 16, left: 12, bottom: 44 },
  horizontalBar: { top: 8, right: 20, left: 12, bottom: 36 },
} as const;

export { chartTooltipProps, chartLegendProps, tooltipCursor } from "@/lib/chartTooltipProps";
