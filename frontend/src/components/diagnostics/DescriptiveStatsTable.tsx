import { INGESTION_DATASETS } from "@/config/datasets";

type DescriptiveStatsTableProps = {
  rows: Array<{ feature: string; training?: Record<string, unknown>; new?: Record<string, unknown> }>;
};

const fmt = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—");

export function DescriptiveStatsTable({ rows }: DescriptiveStatsTableProps) {
  const devLabel = INGESTION_DATASETS.dev_data.label;
  const newLabel = INGESTION_DATASETS.new_data.label;

  return (
    <div className="w-full rounded-md border border-gray-200 dark:border-slate-700 overflow-hidden">
      <table className="w-full table-fixed text-[10px] leading-tight sm:text-xs">
        <thead className="bg-gray-50 dark:bg-slate-900">
          <tr className="text-left">
            <th className="w-[11%] px-1.5 py-1.5 font-semibold text-gray-900 dark:text-gray-100 truncate">Feature</th>
            <th className="w-[8%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">{devLabel} mean</th>
            <th className="w-[8%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">{newLabel} mean</th>
            <th className="w-[7%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">Δ mean</th>
            <th className="w-[7%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">{devLabel} P50</th>
            <th className="w-[7%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">{newLabel} P50</th>
            <th className="w-[7%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">{devLabel} std</th>
            <th className="w-[7%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">{newLabel} std</th>
            <th className="w-[8%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">{devLabel} miss%</th>
            <th className="w-[8%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">{newLabel} miss%</th>
            <th className="w-[8%] px-1 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 truncate">Δ miss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const trainMean = Number(row.training?.mean ?? NaN);
            const newMean = Number(row.new?.mean ?? NaN);
            const trainMiss = Number(row.training?.missing_pct ?? NaN);
            const newMiss = Number(row.new?.missing_pct ?? NaN);
            const deltaMean = Number.isFinite(trainMean) && Number.isFinite(newMean) ? newMean - trainMean : NaN;
            const deltaMiss = Number.isFinite(trainMiss) && Number.isFinite(newMiss) ? newMiss - trainMiss : NaN;
            return (
              <tr
                key={row.feature}
                className="border-t border-gray-200 dark:border-slate-700 hover:bg-gray-50/70 dark:hover:bg-slate-900/60"
              >
                <td className="px-1.5 py-1 text-gray-900 dark:text-gray-100 truncate" title={row.feature}>
                  {row.feature}
                </td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(trainMean)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(newMean)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(deltaMean)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(row.training?.p50)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(row.new?.p50)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(row.training?.std)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(row.new?.std)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(trainMiss)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(newMiss)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmt(deltaMiss)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
