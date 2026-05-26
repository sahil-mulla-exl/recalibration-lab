import type { CSSProperties } from "react";

export type ChartTheme = {
  isDark: boolean;
  axisText: string;
  axisTextSubtle: string;
  gridStroke: string;
  championColor: string;
  challengerColor: string;
  tooltipStyle: CSSProperties;
};

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function resolveHslVar(name: string, fallback: string) {
  const value = cssVar(name, "");
  return value ? `hsl(${value})` : fallback;
}

export function getChartTheme(): ChartTheme {
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  return {
    isDark,
    axisText: isDark ? "#9fb0c6" : "#7f90a8",
    axisTextSubtle: isDark ? "#7e8ca0" : "#9aa8bb",
    gridStroke: isDark ? "#344052" : "#9ca3af",
    championColor: cssVar("--midas-chart-champion", "#005071"),
    challengerColor: resolveHslVar("--primary", "#FB4E0B"),
    tooltipStyle: isDark
      ? { background: "#151f2e", border: "1px solid #344052", fontSize: 11, borderRadius: 8, color: "#f8fafc" }
      : { background: "#ffffff", border: "1px solid #9ca3af", fontSize: 11, borderRadius: 8, color: "#0f172a" },
  };
}
