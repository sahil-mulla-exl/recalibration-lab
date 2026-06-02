import {

  Table,

  TableBody,

  TableCell,

  TableHead,

  TableHeader,

  TableRow,

} from "@/components/ui/table";

import { EVALUATION_SERIES } from "@/config/evaluation";



export type EvaluationMetricRow = {

  metric: string;

  hold: number;

  oos: number;

  recal: number;

  format?: (v: number) => string;

  higherIsBetter?: boolean;

};



type EvaluationMetricsTableProps = {

  rows: EvaluationMetricRow[];

};



function defaultFormat(v: number) {

  return Number.isFinite(v) ? v.toFixed(4) : "—";

}



export function EvaluationMetricsTable({ rows }: EvaluationMetricsTableProps) {

  return (

    <div className="rounded-xl border border-border overflow-hidden">

      <Table>

        <TableHeader>

          <TableRow>

            <TableHead>Metric</TableHead>

            <TableHead className="text-right">{EVALUATION_SERIES.championHold}</TableHead>

            <TableHead className="text-right">{EVALUATION_SERIES.championOos}</TableHead>

            <TableHead className="text-right">{EVALUATION_SERIES.recalibratedOos}</TableHead>

            <TableHead className="text-right">Δ (Recal − Production)</TableHead>

          </TableRow>

        </TableHeader>

        <TableBody>

          {rows.map((row) => {

            const fmt = row.format ?? defaultFormat;

            const delta = row.recal - row.oos;

            const higherIsBetter = row.higherIsBetter ?? true;

            const improved = higherIsBetter ? delta > 0 : delta < 0;

            return (

              <TableRow key={row.metric}>

                <TableCell className="font-medium">{row.metric}</TableCell>

                <TableCell className="text-right font-mono text-sm">{fmt(row.hold)}</TableCell>

                <TableCell className="text-right font-mono text-sm">{fmt(row.oos)}</TableCell>

                <TableCell className="text-right font-mono text-sm">{fmt(row.recal)}</TableCell>

                <TableCell

                  className={`text-right font-mono text-sm ${

                    improved ? "text-emerald-600 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400"

                  }`}

                >

                  {delta >= 0 ? "+" : ""}

                  {fmt(delta)}

                </TableCell>

              </TableRow>

            );

          })}

        </TableBody>

      </Table>

    </div>

  );

}


