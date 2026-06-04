import { driftBaselineLabel, perfNewLabel } from "@/config/datasets";
import { Card } from "@/components/ui/card";

type CategoricalDriftRowProps = {
  feature: string;
  trainCount: number;
  newCount: number;
  newOnly: string[];
  lost: string[];
};

export function CategoricalDriftRow({
  feature,
  trainCount,
  newCount,
  newOnly,
  lost,
}: CategoricalDriftRowProps) {
  const hasNew = newOnly.length > 0;
  const hasLost = lost.length > 0;
  const isStable = !hasNew && !hasLost;
  const tone = hasNew ? "critical" : hasLost ? "warning" : "stable";

  const leftBorderClass =
    tone === "critical"
      ? "border-l-red-500"
      : tone === "warning"
        ? "border-l-amber-500"
        : "border-l-emerald-500";

  const statusBadgeClass =
    tone === "critical"
      ? "bg-red-500/10 text-red-600 dark:text-red-300 border-red-200 dark:border-red-800"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-200 dark:border-amber-800"
        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";

  const statusText = hasNew ? "New category" : hasLost ? "Lost category" : "Stable";
  const summaryText = isStable
    ? `${trainCount} → ${newCount} categories (stable)`
    : `${newOnly.length} new, ${lost.length} lost vs ${driftBaselineLabel().toLowerCase()}`;

  const pillClass =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800 dark:text-gray-200 dark:border-slate-700";
  const newPillClass =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-300 dark:border-emerald-800";
  const lostPillClass =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-300 dark:border-amber-800";

  return (
    <Card className={`p-3 border-l-4 ${leftBorderClass}`}>
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr_1fr_auto] gap-3 items-start">
        <div>
          <div className="font-semibold text-sm">{feature}</div>
          <div className="text-xs text-muted-foreground mt-1">{summaryText}</div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{driftBaselineLabel()}</div>
          <div className="text-sm font-mono tabular-nums">{trainCount} categories</div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{perfNewLabel()}</div>
          <div className="text-sm font-mono tabular-nums mb-1">{newCount} categories</div>
          {(hasNew || hasLost) && (
            <div className="flex flex-wrap gap-1">
              {newOnly.map((cat) => (
                <span key={`new-${feature}-${cat}`} className={newPillClass}>
                  {cat}
                </span>
              ))}
              {lost.map((cat) => (
                <span key={`lost-${feature}-${cat}`} className={lostPillClass}>
                  {cat}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-[130px]">
          <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold ${statusBadgeClass}`}>
            {statusText}
          </span>
        </div>
      </div>
    </Card>
  );
}
