import { Card } from "@/components/ui/card";

import { DIAGNOSTICS_BENCHMARK_TILES } from "@/config/datasets";



type BenchmarkBannerProps = {

  datasets?: Record<string, unknown>;

};



export function BenchmarkBanner({ datasets }: BenchmarkBannerProps) {

  return (

    <Card className="p-4 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950 shadow-sm">

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

        {DIAGNOSTICS_BENCHMARK_TILES.map((tile) => {

          const rows = Number(datasets?.[tile.rowsKey] ?? 0);

          return (

            <div key={tile.rowsKey} className="rounded-lg border border-gray-200 dark:border-slate-800 px-3 py-2">

              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{tile.label}</div>

              <div className="font-semibold text-gray-900 dark:text-gray-100">{rows.toLocaleString()} rows</div>

              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{tile.hint}</div>

            </div>

          );

        })}

      </div>

    </Card>

  );

}

