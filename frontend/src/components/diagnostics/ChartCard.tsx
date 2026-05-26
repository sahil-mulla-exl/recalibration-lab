import type { ReactNode } from "react";
import { cn } from "@/utils/utils";

type ChartCardProps = {
  title: string;
  subtitle?: string;
  conclusion?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Extra classes on the card (e.g. width constraints) */
  className?: string;
};

export function ChartCard({
  title,
  subtitle,
  conclusion,
  actions,
  children,
  className,
}: ChartCardProps) {
  return (
    <section
      data-chart-card
      className={cn(
        "chart-card rounded-xl p-4 w-full min-w-0 max-w-full overflow-hidden",
        "bg-card text-card-foreground border-2 border-border shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="chart-card-title text-sm font-semibold text-foreground">{title}</h3>
            {conclusion ? (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                {conclusion}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="chart-card-body text-foreground">{children}</div>
    </section>
  );
}
