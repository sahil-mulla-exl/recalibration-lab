import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/utils";
import {
  type FeatureScreenerMetrics,
  type ScreenerFilter,
  featurePassesFilters,
} from "@/lib/featureScreener";
import { FeatureScreenerFilters } from "@/components/recalibration/FeatureScreenerFilters";

const COLS = 3;
const ROWS = 10;
const ROW_HEIGHT_PX = 40;
const PAGE_SIZE = COLS * ROWS;

const csiColor = (v: number) => (v >= 0.25 ? "#f97316" : v >= 0.1 ? "#facc15" : "#34d399");
const csiText = (v: number) =>
  v >= 0.25 ? "text-orange-400" : v >= 0.1 ? "text-yellow-400" : "text-emerald-400";
const csiBg = (v: number, dropped: boolean) =>
  dropped
    ? "bg-muted/10 border-border/30 opacity-50"
    : v >= 0.25
      ? "bg-orange-500/8 border-orange-500/25 hover:border-orange-500/50"
      : v >= 0.1
        ? "bg-yellow-500/8 border-yellow-500/20 hover:border-yellow-500/40"
        : "bg-card border-border hover:border-primary/30";

type FeatureSelectionPanelProps = {
  features: string[];
  drops: string[];
  csiMap: Record<string, number>;
  metricsByFeature?: Record<string, FeatureScreenerMetrics>;
  screenerFilters?: ScreenerFilter[];
  onScreenerFiltersChange?: (filters: ScreenerFilter[]) => void;
  onConfirmScreener?: () => void;
  onToggleDrop: (feat: string) => void;
  onClearDrops: () => void;
};

export function FeatureSelectionPanel({
  features,
  drops,
  csiMap,
  metricsByFeature = {},
  screenerFilters = [],
  onScreenerFiltersChange,
  onConfirmScreener,
  onToggleDrop,
  onClearDrops,
}: FeatureSelectionPanelProps) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return features.filter((f) => {
      if (q && !f.toLowerCase().includes(q)) return false;
      if (
        screenerFilters.length > 0 &&
        !featurePassesFilters(metricsByFeature[f], screenerFilters, "and")
      ) {
        return false;
      }
      return true;
    });
  }, [features, query, screenerFilters, metricsByFeature]);

  const handleDropFailing = () => {
    features
      .filter(
        (f) =>
          !drops.includes(f) &&
          !featurePassesFilters(metricsByFeature[f], screenerFilters, "and"),
      )
      .forEach((f) => onToggleDrop(f));
  };

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!hasMore) return;
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
        setVisibleCount((n) => Math.min(n + PAGE_SIZE, filtered.length));
      }
    },
    [hasMore, filtered.length],
  );

  return (
    <div className="space-y-3">
      {onScreenerFiltersChange && (
        <FeatureScreenerFilters
          features={features}
          metricsByFeature={metricsByFeature}
          filters={screenerFilters}
          onChangeFilters={onScreenerFiltersChange}
          onDropFailing={screenerFilters.length > 0 ? handleDropFailing : undefined}
          onConfirmSelection={onConfirmScreener}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search feature name…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground">{features.length - drops.length}</span> / {features.length}{" "}
            retained
            {screenerFilters.length > 0 && filtered.length !== features.length && (
              <span className="ml-1">· {filtered.length} shown</span>
            )}
          </span>
          {drops.length > 0 && (
            <button type="button" onClick={onClearDrops} className="text-muted-foreground hover:text-foreground underline">
              Clear drops
            </button>
          )}
        </div>
      </div>

      {features.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No model features found. Upload a .pkl and complete data processing first.
        </p>
      ) : (
        <>
          <div
            className="overflow-y-auto overflow-x-hidden rounded-lg border border-border/60 bg-muted/5 pr-1"
            style={{ maxHeight: `${ROWS * ROW_HEIGHT_PX + 12}px` }}
            onScroll={onScroll}
          >
            <div
              className="grid gap-1.5 p-1.5"
              style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
            >
              {visible.map((feat) => {
                const csi = csiMap[feat] || 0;
                const isDrop = drops.includes(feat);
                return (
                  <label
                    key={feat}
                    className={cn(
                      "relative flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-pointer transition-all",
                      csiBg(csi, isDrop),
                    )}
                    style={{ minHeight: `${ROW_HEIGHT_PX}px` }}
                    title={feat}
                  >
                    {csi > 0 && !isDrop && (
                      <div
                        className="absolute left-0 top-0 bottom-0 rounded-l-lg pointer-events-none"
                        style={{
                          width: `${Math.min(csi / 0.5, 1) * 100}%`,
                          background: `${csiColor(csi)}14`,
                        }}
                      />
                    )}
                    <input
                      type="checkbox"
                      checked={!isDrop}
                      onChange={() => onToggleDrop(feat)}
                      className="relative h-3.5 w-3.5 shrink-0 accent-primary"
                    />
                    <span
                      className={cn(
                        "relative min-w-0 flex-1 truncate text-xs",
                        isDrop ? "line-through text-muted-foreground/50" : "font-medium",
                      )}
                    >
                      {feat}
                    </span>
                    <span
                      className={cn(
                        "relative shrink-0 text-[10px] font-mono tabular-nums",
                        isDrop ? "opacity-40 text-muted-foreground" : csiText(csi),
                      )}
                    >
                      CSI {csi.toFixed(2)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          
        </>
      )}
    </div>
  );
}
