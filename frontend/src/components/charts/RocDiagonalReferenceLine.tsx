import { ReferenceLine } from "recharts";
import type { ChartTheme } from "@/lib/chartTheme";

/** Random-classifier reference: 45° line from (0, 0) to (1, 1) on ROC plots (FPR vs TPR). */
export function RocDiagonalReferenceLine({ theme }: { theme: ChartTheme }) {
  return (
    <ReferenceLine
      segment={[
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]}
      stroke={theme.referenceLine}
      strokeWidth={theme.plot.barStrokeWidth}
      strokeDasharray="5 5"
      ifOverflow="visible"
    />
  );
}
