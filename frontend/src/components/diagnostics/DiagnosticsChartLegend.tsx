import type { LegendProps } from "recharts";
import type { ChartTheme } from "@/lib/chartTheme";

type DiagnosticsChartLegendProps = LegendProps & {
  theme: ChartTheme;
  align?: "left" | "center";
};

export function DiagnosticsChartLegend({ payload, theme, align = "center" }: DiagnosticsChartLegendProps) {
  if (!payload?.length) return null;

  const color = String(theme.legend.color ?? (theme.isDark ? "#e2e8f0" : "#0f172a"));

  return (
    <ul
      className={`recharts-legend-list flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 ${
        align === "left" ? "justify-start" : "justify-center"
      }`}
      style={{ color, fontSize: 12 }}
    >
      {payload.map((entry, index) => {
        const swatchColor = entry.color ?? theme.series.new;
        const isLine = entry.type === "line";
        return (
          <li
            key={`${entry.value ?? entry.dataKey}-${index}`}
            className="recharts-legend-item flex items-center gap-1.5"
          >
            {isLine ? (
              <span className="inline-flex items-center shrink-0" aria-hidden>
                <span
                  className="inline-block h-0.5 w-4 rounded-full"
                  style={{ backgroundColor: swatchColor }}
                />
                <span
                  className="inline-block h-2 w-2 rounded-full -ml-1.5 border border-background"
                  style={{ backgroundColor: swatchColor }}
                />
              </span>
            ) : (
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border"
                style={{
                  backgroundColor: swatchColor,
                  borderColor: swatchColor,
                }}
              />
            )}
            <span className="recharts-legend-item-text" style={{ color }}>
              {entry.value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
