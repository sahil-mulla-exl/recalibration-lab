import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/utils/utils";

type ChartPlotProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

/** Constrains chart area to parent card width without horizontal blowout. */
export function ChartPlot({ children, className, style }: ChartPlotProps) {
  return (
    <div
      className={cn("diagnostics-chart w-full min-w-0 max-w-full overflow-hidden", className)}
      style={style}
    >
      {children}
    </div>
  );
}
