import type { ReactNode } from "react";
import { ChartPlot } from "@/components/diagnostics/ChartPlot";
import {
  DiagnosticsChartLegend,
  type DiagnosticsChartLegendProps,
} from "@/components/diagnostics/DiagnosticsChartLegend";
import { CARD_CHART_HEIGHT } from "@/lib/chartLayout";
import type { ChartTheme } from "@/lib/chartTheme";

export type ChartLegendItem = NonNullable<DiagnosticsChartLegendProps["payload"]>[number];

type ChartFrameProps = {
  children: ReactNode;
  height?: number;
  theme: ChartTheme;
  legend?: ChartLegendItem[];
  legendAlign?: "left" | "center";
  className?: string;
};

/** Plot area + optional legend below (legend never steals space from the SVG). */
export function ChartFrame({
  children,
  height = CARD_CHART_HEIGHT,
  theme,
  legend,
  legendAlign = "center",
  className,
}: ChartFrameProps) {
  return (
    <div className={`chart-frame w-full min-w-0 ${className ?? ""}`}>
      <ChartPlot style={{ height, minHeight: height }} className="w-full">
        {children}
      </ChartPlot>
      {legend && legend.length > 0 ? (
        <DiagnosticsChartLegend payload={legend} theme={theme} align={legendAlign} />
      ) : null}
    </div>
  );
}
