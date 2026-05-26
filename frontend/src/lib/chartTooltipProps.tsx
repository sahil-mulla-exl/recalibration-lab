import type { LegendProps, TooltipProps } from "recharts";
import { DiagnosticsChartLegend } from "@/components/diagnostics/DiagnosticsChartLegend";
import { DiagnosticsChartTooltip } from "@/components/diagnostics/DiagnosticsChartTooltip";
import type { ChartTheme } from "@/lib/chartTheme";

export function tooltipCursor(theme: ChartTheme, kind: "bar" | "line" = "bar") {
  if (kind === "line") {
    return {
      stroke: theme.isDark ? "rgba(148, 163, 184, 0.45)" : "rgba(100, 116, 139, 0.4)",
      strokeWidth: 1,
      strokeDasharray: "4 4",
    };
  }
  return {
    fill: theme.isDark ? "rgba(148, 163, 184, 0.14)" : "rgba(15, 23, 42, 0.06)",
    stroke: theme.isDark ? "rgba(148, 163, 184, 0.22)" : "rgba(15, 23, 42, 0.1)",
    strokeWidth: 1,
  };
}

export function chartTooltipProps(
  theme: ChartTheme,
  options?: { cursor?: "bar" | "line" | false },
) {
  return {
    cursor: options?.cursor === false ? false : tooltipCursor(theme, options?.cursor ?? "bar"),
    wrapperStyle: { outline: "none", zIndex: 60, pointerEvents: "none" as const },
    content: (props: TooltipProps<number, string>) => (
      <DiagnosticsChartTooltip {...props} theme={theme} />
    ),
  };
}

export function chartLegendProps(
  theme: ChartTheme,
  options?: {
    formatter?: (value: string) => string;
    verticalAlign?: LegendProps["verticalAlign"];
    height?: number;
  },
) {
  return {
    verticalAlign: options?.verticalAlign ?? "bottom",
    height: options?.height,
    wrapperStyle: { width: "100%", paddingTop: 6 },
    content: (props: LegendProps) => {
      const payload = props.payload?.map((entry) => {
        const raw = String(entry.value ?? "");
        const label = options?.formatter ? options.formatter(raw) : raw;
        return { ...entry, value: label };
      });
      return <DiagnosticsChartLegend {...props} payload={payload} theme={theme} />;
    },
  };
}
