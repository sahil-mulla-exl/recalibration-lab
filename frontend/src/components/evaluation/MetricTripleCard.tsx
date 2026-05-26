import { TrendingDown, TrendingUp } from "lucide-react";

function DeltaChip({
  value,
  higherIsBetter = true,
  format = (v: number) => v.toFixed(4),
}: {
  value: number;
  higherIsBetter?: boolean;
  format?: (v: number) => string;
}) {
  const good = higherIsBetter ? value > 0 : value < 0;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full border ${
        good
          ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-800 dark:text-emerald-400"
          : "bg-orange-500/10 border-orange-500/25 text-orange-800 dark:text-orange-400"
      }`}
    >
      {good ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {value > 0 ? "+" : ""}
      {format(value)}
    </span>
  );
}

type MetricTripleCardProps = {
  label: string;
  championHold: number;
  championOos: number;
  recalibratedOos: number;
  championHoldColor: string;
  championOosColor: string;
  recalibratedColor: string;
  championHoldLabel: string;
  championOosLabel: string;
  recalibratedLabel: string;
  format?: (v: number) => string;
  higherIsBetter?: boolean;
};

export function MetricTripleCard({
  label,
  championHold,
  championOos,
  recalibratedOos,
  championHoldColor,
  championOosColor,
  recalibratedColor,
  championHoldLabel,
  championOosLabel,
  recalibratedLabel,
  format = (v) => v.toFixed(4),
  higherIsBetter = true,
}: MetricTripleCardProps) {
  const delta = recalibratedOos - championOos;
  const good = higherIsBetter ? delta > 0 : delta < 0;

  const Cell = ({
    title,
    value,
    color,
    highlight,
  }: {
    title: string;
    value: number;
    color: string;
    highlight?: boolean;
  }) => (
    <div
      className={`text-center p-2 rounded-lg border ${
        highlight
          ? good
            ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/25"
            : "bg-orange-50 border-orange-200 dark:bg-orange-500/8 dark:border-orange-500/25"
          : "bg-muted/30 border-border/60 dark:bg-muted/20"
      }`}
    >
      <p className="text-[9px] text-muted-foreground mb-1 leading-tight min-h-[2.5rem] flex items-end justify-center">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-left text-foreground/80">{title}</span>
        </span>
      </p>
      <p
        className={`text-base font-bold font-mono ${
          highlight
            ? good
              ? "text-emerald-800 dark:text-emerald-400"
              : "text-orange-800 dark:text-orange-400"
            : "text-foreground"
        }`}
      >
        {format(value)}
      </p>
    </div>
  );

  return (
    <div
      className={`rounded-xl border-2 border-border bg-card p-4 space-y-3 shadow-sm transition-colors ${
        good ? "border-emerald-200/80 dark:border-emerald-500/20" : "border-orange-200/80 dark:border-orange-500/15"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Cell title={championHoldLabel} value={championHold} color={championHoldColor} />
        <Cell title={championOosLabel} value={championOos} color={championOosColor} />
        <Cell title={recalibratedLabel} value={recalibratedOos} color={recalibratedColor} highlight />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-[10px] text-muted-foreground">Δ vs champion on new holdout</p>
        <DeltaChip value={delta} higherIsBetter={higherIsBetter} format={format} />
      </div>
    </div>
  );
}
