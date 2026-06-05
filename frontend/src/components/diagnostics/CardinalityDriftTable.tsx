import { useMemo, useState } from "react";

import { driftBaselineLabel, perfNewLabel } from "@/config/datasets";

export type CardinalityDriftRow = {
  feature: string;
  trainCount: number;
  newCount: number;
  newOnly: string[];
  lost: string[];
};

type CardinalityFilter = "all" | "new" | "lost" | "stable";

type CardinalityDriftTableProps = {
  rows: CardinalityDriftRow[];
};

const FILTERS: Array<{ id: CardinalityFilter; label: string }> = [
  { id: "all", label: "All features" },
  { id: "new", label: "New category" },
  { id: "lost", label: "Lost category" },
  { id: "stable", label: "Stable" },
];

function rowStatus(row: CardinalityDriftRow): Exclude<CardinalityFilter, "all"> {
  if (row.newOnly.length > 0) return "new";
  if (row.lost.length > 0) return "lost";
  return "stable";
}

function statusLabel(status: Exclude<CardinalityFilter, "all">): string {
  if (status === "new") return "New category";
  if (status === "lost") return "Lost category";
  return "Stable";
}

const STATUS_CLASSES: Record<Exclude<CardinalityFilter, "all">, string> = {
  new: "text-red-500 dark:text-red-300",
  lost: "text-amber-500 dark:text-amber-300",
  stable: "text-emerald-500 dark:text-emerald-300",
};

export function CardinalityDriftTable({ rows }: CardinalityDriftTableProps) {
  const [activeFilter, setActiveFilter] = useState<CardinalityFilter>("all");

  const filteredRows = useMemo(
    () => (activeFilter === "all" ? rows : rows.filter((row) => rowStatus(row) === activeFilter)),
    [rows, activeFilter],
  );

  const summary = useMemo(
    () => ({
      total: rows.length,
      newCategory: rows.filter((row) => row.newOnly.length > 0).length,
      lostCategory: rows.filter((row) => row.lost.length > 0).length,
      stable: rows.filter((row) => row.newOnly.length === 0 && row.lost.length === 0).length,
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
        <span className="px-2 py-1 rounded border bg-muted/40 font-semibold uppercase tracking-wide">
          {summary.total} Total
        </span>
        <span className="px-2 py-1 rounded border bg-red-500/10 border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 font-semibold uppercase tracking-wide">
          {summary.newCategory} New Category
        </span>
        <span className="px-2 py-1 rounded border bg-amber-500/10 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-300 font-semibold uppercase tracking-wide">
          {summary.lostCategory} Lost Category
        </span>
        <span className="px-2 py-1 rounded border bg-emerald-500/10 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-300 font-semibold uppercase tracking-wide">
          {summary.stable} Stable
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
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.newOnly.length}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.lost.length}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.newOnly.length > 0 ? row.newOnly.join(", ") : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.lost.length > 0 ? row.lost.join(", ") : "—"}
                  </td>
                  <td className={`px-3 py-2 text-xs font-medium capitalize ${STATUS_CLASSES[status]}`}>
                    {statusLabel(status)}
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
