import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShapFlagCards } from "@/components/diagnostics/ShapFlagCards";
import { EVALUATION_SERIES } from "@/config/evaluation";
import { useChartTheme } from "@/lib/chartTheme";
import {
  XgbSingleImportanceChart,
  type XgbImportanceBarRow,
} from "@/components/evaluation/XgbSingleImportanceChart";
import type { XgbComparisonRow } from "@/components/evaluation/EvaluationXgbImportance";

export type ShapImportancePayload = {
  available: boolean;
  champion: Record<string, number>;
  recalibrated: Record<string, number>;
  comparison: XgbComparisonRow[];
  shap_flags?: Record<string, unknown>;
};

type EvaluationShapImportanceProps = {
  payload: ShapImportancePayload | null | undefined;
};

type SortKey = "prod_rank" | "recal_rank";

function sortComparisonRows(rows: XgbComparisonRow[], sortBy: SortKey): XgbComparisonRow[] {
  const sorted = [...rows];
  if (sortBy === "recal_rank") {
    sorted.sort((a, b) => a.recal_rank - b.recal_rank || a.feature.localeCompare(b.feature));
  } else {
    sorted.sort((a, b) => a.champion_rank - b.champion_rank || a.feature.localeCompare(b.feature));
  }
  return sorted;
}

function shiftRating(delta: number): "Stable" | "Minor shift" | "Major shift" {
  const abs = Math.abs(delta);
  if (abs === 0) return "Stable";
  if (abs <= 2) return "Minor shift";
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

export function EvaluationShapImportance({ payload }: EvaluationShapImportanceProps) {
  const theme = useChartTheme();
  const [topN, setTopN] = useState<number>(10);
  const [sortBy, setSortBy] = useState<SortKey>("prod_rank");

  const normalizedComparison = useMemo((): XgbComparisonRow[] => {
    return (payload?.comparison ?? []).map((row) => ({
      feature: row.feature,
      champion_importance: Number(row.champion_importance ?? 0),
      recal_importance: Number(row.recal_importance ?? 0),
      champion_rank: Number(row.champion_rank ?? 0),
      recal_rank: Number(row.recal_rank ?? 0),
      rank_delta: Number(row.rank_delta ?? 0),
    }));
  }, [payload]);

  const comparisonRows = useMemo(() => {
    const sorted = sortComparisonRows(normalizedComparison, sortBy);
    return sorted.slice(0, topN === 9999 ? sorted.length : topN);
  }, [normalizedComparison, sortBy, topN]);

  const championRows = useMemo(
    (): XgbImportanceBarRow[] =>
      comparisonRows.map((row) => ({
        feature: row.feature,
        importance: row.champion_importance,
      })),
    [comparisonRows],
  );
  const recalRows = useMemo(
    (): XgbImportanceBarRow[] =>
      comparisonRows.map((row) => ({
        feature: row.feature,
        importance: row.recal_importance,
      })),
    [comparisonRows],
  );

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-sm mb-1">SHAP Feature Importance</h3>
          <p className="text-xs text-muted-foreground">
            Mean |SHAP| on {EVALUATION_SERIES.championOos} features — production model vs recalibrated model
            (same cohort as XGBoost native importance).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Sort by</span>
          <select
            className="h-8 rounded border px-2 bg-background"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
          >
            <option value="prod_rank">Prod rank</option>
            <option value="recal_rank">Recal rank</option>
          </select>
          <span className="text-muted-foreground">Top</span>
          <select
            className="h-8 rounded border px-2 bg-background"
            value={String(topN)}
            onChange={(e) => setTopN(Number(e.target.value))}
          >
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="9999">All</option>
          </select>
        </div>
      </div>

      {!payload?.available ? (
        <p className="text-sm text-muted-foreground">
          SHAP could not be computed for the production and recalibrated models. Re-run evaluation after
          recalibration completes.
        </p>
      ) : (
        <div className="space-y-5">
          {payload.shap_flags && Object.keys(payload.shap_flags).length > 0 && (
            <ShapFlagCards flags={payload.shap_flags} />
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Production model ({EVALUATION_SERIES.championOos})
              </p>
              <XgbSingleImportanceChart
                rows={championRows}
                color={theme.series.train}
                fill={theme.series.trainFill}
                title={`Production · ${EVALUATION_SERIES.championOos}`}
              />
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Recalibrated model ({EVALUATION_SERIES.recalibratedOos})
              </p>
              <XgbSingleImportanceChart
                rows={recalRows}
                color={theme.series.new}
                fill={theme.series.newFill}
                title={`Recalibrated · ${EVALUATION_SERIES.recalibratedOos}`}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead className="text-right">Prod rank</TableHead>
                  <TableHead className="text-right">Recal rank</TableHead>
                  <TableHead className="text-right">Rank Δ</TableHead>
                  <TableHead className="text-right">Prod SHAP</TableHead>
                  <TableHead className="text-right">Recal SHAP</TableHead>
                  <TableHead className="text-right">Stability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonRows.map((row) => {
                  const delta = row.rank_delta;
                  const deltaLabel = delta === 0 ? "—" : delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`;
                  const deltaClass =
                    delta === 0
                      ? "text-muted-foreground"
                      : Math.abs(delta) >= 3
                        ? delta > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                        : "text-amber-600 dark:text-amber-400";
                  const rating = shiftRating(delta);
                  return (
                    <TableRow key={row.feature}>
                      <TableCell className="font-medium">{row.feature}</TableCell>
                      <TableCell className="text-right font-mono text-sm">#{row.champion_rank}</TableCell>
                      <TableCell className="text-right font-mono text-sm">#{row.recal_rank}</TableCell>
                      <TableCell className={`text-right font-mono text-sm ${deltaClass}`}>{deltaLabel}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.champion_importance.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.recal_importance.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right">
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
        </div>
      )}
    </Card>
  );
}
