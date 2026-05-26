import { perfBaselineLabel, perfNewLabel } from "@/config/datasets";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ShapImportanceRow = {
  feature: string;
  devRank: number;
  newRank: number;
  devImportance: number;
  newImportance: number;
};

type ShapImportanceTableProps = { rows: ShapImportanceRow[] };

function rankDelta(devRank: number, newRank: number) {
  return devRank - newRank;
}

function shiftRating(devRank: number, newRank: number): "Stable" | "Minor shift" | "Major shift" {
  const delta = Math.abs(rankDelta(devRank, newRank));
  if (delta === 0) return "Stable";
  if (delta <= 2) return "Minor shift";
  return "Major shift";
}

function ratingClass(rating: ReturnType<typeof shiftRating>) {
  if (rating === "Stable") {
    return "bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-300 dark:border-emerald-800";
  }
  if (rating === "Minor shift") {
    return "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-300 dark:border-amber-800";
  }
  return "bg-red-500/10 text-red-700 border-red-200 dark:text-red-300 dark:border-red-800";
}

function ImportanceBar({ value, max, variant }: { value: number; max: number; variant: "dev" | "new" }) {
  const widthPct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const barClass = variant === "dev" ? "bg-slate-400 dark:bg-slate-500" : "bg-primary";
  return (
    <div className="flex items-center gap-2 min-w-[7rem]">
      <div className="h-1.5 flex-1 max-w-[5rem] rounded-sm bg-muted/40 overflow-hidden">
        <div className={`h-full rounded-sm ${barClass}`} style={{ width: `${widthPct}%` }} />
      </div>
      <span className="text-[10.5px] font-mono text-muted-foreground tabular-nums">{value.toFixed(3)}</span>
    </div>
  );
}

export function ShapImportanceTable({ rows }: ShapImportanceTableProps) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground py-4">No SHAP importance data available.</p>;
  }

  const maxImportance = Math.max(
    ...rows.flatMap((r) => [r.devImportance, r.newImportance]),
    1e-6,
  );

  return (
    <div className="rounded-md border border-gray-200 dark:border-slate-700 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50 dark:bg-slate-900">
            <TableHead className="w-8 text-xs">#</TableHead>
            <TableHead className="text-xs">Feature</TableHead>
            <TableHead className="text-xs text-right">{perfBaselineLabel()} rank</TableHead>
            <TableHead className="text-xs text-right">{perfNewLabel()} rank</TableHead>
            <TableHead className="text-xs text-right">Rank Δ</TableHead>
            <TableHead className="text-xs">{perfBaselineLabel()} importance</TableHead>
            <TableHead className="text-xs">{perfNewLabel()} importance</TableHead>
            <TableHead className="text-xs">Rating</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const delta = rankDelta(row.devRank, row.newRank);
            const rating = shiftRating(row.devRank, row.newRank);
            const deltaLabel =
              delta === 0 ? "—" : delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`;
            const deltaClass =
              delta === 0
                ? "text-muted-foreground"
                : Math.abs(delta) >= 3
                  ? delta > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400";

            return (
              <TableRow
                key={row.feature}
                className="border-t border-gray-200 dark:border-slate-700 hover:bg-gray-50/70 dark:hover:bg-slate-900/60"
              >
                <TableCell className="text-xs text-muted-foreground py-2">{index + 1}</TableCell>
                <TableCell className="text-xs font-semibold text-gray-900 dark:text-gray-100 py-2">
                  {row.feature}
                </TableCell>
                <TableCell className="text-xs text-right font-mono py-2">#{row.devRank}</TableCell>
                <TableCell className="text-xs text-right font-mono py-2">#{row.newRank}</TableCell>
                <TableCell className={`text-xs text-right font-mono py-2 ${deltaClass}`}>{deltaLabel}</TableCell>
                <TableCell className="py-2">
                  <ImportanceBar value={row.devImportance} max={maxImportance} variant="dev" />
                </TableCell>
                <TableCell className="py-2">
                  <ImportanceBar value={row.newImportance} max={maxImportance} variant="new" />
                </TableCell>
                <TableCell className="py-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ratingClass(rating)}`}
                  >
                    {rating}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
