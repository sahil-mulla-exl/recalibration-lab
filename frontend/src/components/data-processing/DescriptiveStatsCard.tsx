import { motion } from "framer-motion";
import { cn } from "@/utils/utils";

type StatRow = {
  feature: string;
  training?: Record<string, unknown>;
  new?: Record<string, unknown>;
};

const fmt = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";

const COLUMNS = [
  { key: "mean_dev", label: "Dev mean", get: (r: StatRow) => r.training?.mean },
  { key: "mean_new", label: "New mean", get: (r: StatRow) => r.new?.mean },
  { key: "delta_mean", label: "Δ mean", get: (r: StatRow) => delta(r.training?.mean, r.new?.mean) },
  { key: "p50_dev", label: "Dev P50", get: (r: StatRow) => r.training?.p50 },
  { key: "p50_new", label: "New P50", get: (r: StatRow) => r.new?.p50 },
  { key: "std_dev", label: "Dev S.D", get: (r: StatRow) => r.training?.std },
  { key: "std_new", label: "New S.D", get: (r: StatRow) => r.new?.std },
  { key: "miss_dev", label: "Dev miss%", get: (r: StatRow) => r.training?.missing_pct },
  { key: "miss_new", label: "New miss%", get: (r: StatRow) => r.new?.missing_pct },
  { key: "delta_miss", label: "Δ miss", get: (r: StatRow) => delta(r.training?.missing_pct, r.new?.missing_pct) },
] as const;

function delta(a: unknown, b: unknown): number | null {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return y - x;
}

function deltaClass(v: number | null): string {
  if (v == null || v === 0) return "text-muted-foreground";
  return Math.abs(v) > 0.05 ? "text-orange-500 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400";
}

type DescriptiveStatsCardProps = { rows: StatRow[] };

export function DescriptiveStatsCard({ rows }: DescriptiveStatsCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-gradient-to-br from-muted/30 via-background to-background overflow-hidden"
    >
      

      <div className="max-h-[min(70vh,520px)] overflow-y-auto overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/90 backdrop-blur-sm text-muted-foreground">
              <th className="text-left font-semibold px-3 py-2 min-w-[120px] sticky left-0 bg-muted/90 z-30">
                Feature
              </th>
              {COLUMNS.map((col) => (
                <th key={col.key} className="text-right font-semibold px-2 py-2 whitespace-nowrap">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.feature}
                className="border-t border-border/50 hover:bg-muted/20 transition-colors"
              >
                <td
                  className="px-3 py-2 font-medium text-foreground sticky left-0 bg-background/95 z-10 truncate max-w-[180px]"
                  title={row.feature}
                >
                  {row.feature}
                </td>
                {COLUMNS.map((col) => {
                  const raw = col.get(row);
                  const isDelta = col.key.startsWith("delta");
                  const num = typeof raw === "number" ? raw : null;
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "px-2 py-2 text-right font-mono tabular-nums",
                        isDelta && deltaClass(num),
                      )}
                    >
                      {fmt(raw)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                  No descriptive statistics available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
