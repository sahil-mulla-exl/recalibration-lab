import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type FeatureScreenerMetrics,
  type ScreenerFilter,
  type ScreenerMetric,
  type ScreenerOperator,
  doesScreenerFilterPass,
  featurePassesFilters,
  screenerMetricLabel,
  screenerOperatorLabel,
} from "@/lib/featureScreener";

type FeatureScreenerFiltersProps = {
  features: string[];
  metricsByFeature: Record<string, FeatureScreenerMetrics>;
  filters: ScreenerFilter[];
  onChangeFilters: (next: ScreenerFilter[]) => void;
  onDropFailing?: () => void;
  onConfirmSelection?: () => void;
};

const METRICS: ScreenerMetric[] = ["iv", "univariate_auc", "csi"];
const OPERATORS: ScreenerOperator[] = ["gte", "lte", "gt", "lt", "eq"];

const DEFAULT_NEW_FILTER: ScreenerFilter = {
  metric: "iv",
  operator: "gte",
  value: 0.02,
};

export function FeatureScreenerFilters({
  features,
  metricsByFeature,
  filters,
  onChangeFilters,
  onDropFailing,
  onConfirmSelection,
}: FeatureScreenerFiltersProps) {
  const passCount = features.filter((f) =>
    featurePassesFilters(metricsByFeature[f], filters, "and"),
  ).length;

  const updateFilter = (index: number, patch: Partial<ScreenerFilter>) => {
    const next = filters.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChangeFilters(next);
  };

  return (
    <div className="rounded-xl border border-border/80 bg-muted/10 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">Screening filters</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Filter by Univariate IV, Univariate AUC, or CSI. All active rules must pass.
          </p>
        </div>
        {filters.length > 0 && (
          <p className="text-[11px] text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">{passCount}</span> of {features.length} pass
          </p>
        )}
      </div>

      {filters.length > 0 && (
        <div className="space-y-2">
          {filters.map((filter, index) => {
            const passCount = features.filter((f) =>
              doesScreenerFilterPass(metricsByFeature[f], filter),
            ).length;
            return (
              <div
                key={`filter_${index}`}
                className="grid grid-cols-12 gap-2 items-center rounded-lg border border-border/60 bg-background/80 p-2"
              >
                <span className="col-span-1 text-[10px] text-muted-foreground">{index + 1}</span>
                <div className="col-span-3">
                  <select
                    className="w-full h-8 rounded border px-2 bg-background text-xs"
                    value={filter.metric}
                    onChange={(e) => updateFilter(index, { metric: e.target.value as ScreenerMetric })}
                  >
                    {METRICS.map((m) => (
                      <option key={m} value={m}>
                        {screenerMetricLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <select
                    className="w-full h-8 rounded border px-2 bg-background text-xs"
                    value={filter.operator}
                    onChange={(e) => updateFilter(index, { operator: e.target.value as ScreenerOperator })}
                  >
                    {OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {screenerOperatorLabel(op)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    step="any"
                    className="w-full h-8 rounded border px-2 bg-background text-xs font-mono"
                    value={Number.isFinite(filter.value) ? filter.value : ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? 0 : Number(e.target.value);
                      updateFilter(index, { value: v });
                    }}
                  />
                </div>
                <div className="col-span-3 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  ✓ {passCount} pass
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive p-1"
                    title="Remove filter"
                    onClick={() => onChangeFilters(filters.filter((_, i) => i !== index))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1"
          onClick={() => onChangeFilters([...filters, { ...DEFAULT_NEW_FILTER }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add filter
        </Button>
        {filters.length > 0 && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onChangeFilters([])}
            >
              Clear filters
            </Button>
            {onDropFailing && passCount < features.length && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 text-xs"
                onClick={onDropFailing}
              >
                Drop {features.length - passCount} failing
              </Button>
            )}
          </>
        )}
        {onConfirmSelection && (
          <Button type="button" size="sm" className="h-8 text-xs" onClick={onConfirmSelection}>
            Confirm selection
          </Button>
        )}
      </div>
    </div>
  );
}
