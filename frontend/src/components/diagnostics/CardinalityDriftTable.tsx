import { useMemo, useState } from "react";

import { driftBaselineLabel, perfNewLabel } from "@/config/datasets";

export type CardinalityDriftRow = {
  feature: string;
  trainCount: number;
  newCount: number;
  newOnlyCount: number;
  lostCount: number;
  newOnly: string[];
  lost: string[];
};

type CardinalityFilter = "all" | "new" | "lost";

type CardinalityDriftTableProps = {
  rows: CardinalityDriftRow[];
};

const FILTERS: Array<{ id: CardinalityFilter; label: string }> = [
  { id: "all", label: "All features" },
  { id: "new", label: "New category" },
  { id: "lost", label: "Lost category" },
];

function rowStatus(row: CardinalityDriftRow): CardinalityFilter | "stable" {
  if (row.newOnlyCount > 0) return "new";
  if (row.lostCount > 0) return "lost";
  return "stable";
}

function statusLabel(status: Exclude<CardinalityFilter, "all">): string {
  if (status === "new") return "New category";
  return "Lost category";
}

const STATUS_CLASSES: Record<Exclude<CardinalityFilter, "all">, string> = {
  new: "text-red-500 dark:text-red-300",
  lost: "text-amber-500 dark:text-amber-300",
};

function formatCategoryLabel(category: string): string {
  if (category === "") return "(empty)";
  return category;
}

function CategoryNameList({
  categories,
  tone,
}: {
  categories: string[];
  tone: "new" | "lost";
}) {
  if (categories.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const pillClass =
    tone === "new"
      ? "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-300 dark:border-emerald-800"
      : "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-300 dark:border-amber-800";

  return (
    <div className="flex flex-wrap gap-1">
      {categories.map((category) => (
        <span key={`${tone}-${category}`} className={pillClass} title={`Category: ${formatCategoryLabel(category)}`}>
          {formatCategoryLabel(category)}
        </span>
      ))}
    </div>
  );
}

export function CardinalityDriftTable({ rows }: CardinalityDriftTableProps) {
  const [activeFilter, setActiveFilter] = useState<CardinalityFilter>("all");

  const filteredRows = useMemo(
    () =>
      activeFilter === "all"
        ? rows
        : rows.filter((row) => rowStatus(row) === activeFilter),
    [rows, activeFilter],
  );

  const summary = useMemo(
    () => ({
      newCategory: rows.filter((row) => row.newOnlyCount > 0).length,
      lostCategory: rows.filter((row) => row.lostCount > 0).length,
    }),
    [rows],
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No categorical features detected for cardinality monitoring on the uploaded datasets.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-1 rounded border bg-red-500/10 border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 font-semibold uppercase tracking-wide">
          {summary.newCategory} New Category
        </span>
        <span className="px-2 py-1 rounded border bg-amber-500/10 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-300 font-semibold uppercase tracking-wide">
          {summary.lostCategory} Lost Category
        </span>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Filter cardinality drift</p>
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as CardinalityFilter)}
        >
          {FILTERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Feature</th>
              <th className="px-3 py-2 font-medium text-right">{`${driftBaselineLabel()} count`}</th>
              <th className="px-3 py-2 font-medium text-right">{`${perfNewLabel()} count`}</th>
              <th className="px-3 py-2 font-medium text-right">New count</th>
              <th className="px-3 py-2 font-medium text-right">Lost count</th>
              <th className="px-3 py-2 font-medium">New categories</th>
              <th className="px-3 py-2 font-medium">Lost categories</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={8}>
                  No features in this filter bucket.
                </td>
              </tr>
            )}
            {filteredRows.map((row) => {
              const status = rowStatus(row);
              return (
                <tr key={row.feature} className="border-t align-top">
                  <td className="px-3 py-2 font-medium">{row.feature}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.trainCount}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.newCount}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.newOnlyCount}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.lostCount}</td>
                  <td className="px-3 py-2 text-xs whitespace-normal break-words">
                    <CategoryNameList categories={row.newOnly} tone="new" />
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-normal break-words">
                    <CategoryNameList categories={row.lost} tone="lost" />
                  </td>
                  <td className="px-3 py-2 text-xs font-medium">
                    {status === "stable" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={STATUS_CLASSES[status]}>{statusLabel(status)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
