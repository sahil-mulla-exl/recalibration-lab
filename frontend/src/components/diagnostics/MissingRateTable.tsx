import { driftBaselineLabel, INGESTION_DATASETS } from "@/config/datasets";
import { useMemo, useState } from "react";

type MissingSeverity = "all" | "critical" | "moderate" | "stable";

type MissingRateRow = {
  feature: string;
  trainMissingPct: number;
  newMissingPct: number;
  deltaPp: number;
  severity: MissingSeverity;
};

type MissingRateTableProps = {
  rows: MissingRateRow[];
};

const FILTERS: Array<{ id: MissingSeverity; label: string }> = [
  { id: "all", label: "All features" },
  { id: "critical", label: "Critical" },
  { id: "moderate", label: "Moderate" },
  { id: "stable", label: "Stable" },
];

const SEVERITY_CLASSES: Record<Exclude<MissingSeverity, "all">, string> = {
  critical: "text-red-400",
  moderate: "text-amber-400",
  stable: "text-emerald-400",
};

export function MissingRateTable({ rows }: MissingRateTableProps) {
  const [activeFilter, setActiveFilter] = useState<MissingSeverity>("all");

  const filteredRows = useMemo(
    () => (activeFilter === "all" ? rows : rows.filter((row) => row.severity === activeFilter)),
    [rows, activeFilter],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Filter missing-rate severity</p>
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as MissingSeverity)}
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
              <th className="px-3 py-2 font-medium">{`${driftBaselineLabel()} %`}</th>
              <th className="px-3 py-2 font-medium">{`${INGESTION_DATASETS.new_data_oos.label} %`}</th>
              <th className="px-3 py-2 font-medium">Delta (pp)</th>
              <th className="px-3 py-2 font-medium">Severity</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                  No features in this severity bucket.
                </td>
              </tr>
            )}
            {filteredRows.map((row) => (
              <tr key={row.feature} className="border-t">
                <td className="px-3 py-2">{row.feature}</td>
                <td className="px-3 py-2">{row.trainMissingPct.toFixed(3)}</td>
                <td className="px-3 py-2">{row.newMissingPct.toFixed(3)}</td>
                <td className="px-3 py-2">{row.deltaPp.toFixed(3)}</td>
                <td className={`px-3 py-2 capitalize font-medium ${SEVERITY_CLASSES[row.severity]}`}>
                  {row.severity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
