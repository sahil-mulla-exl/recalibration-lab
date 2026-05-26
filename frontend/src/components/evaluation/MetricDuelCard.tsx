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
          ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
          : "bg-orange-500/10 border-orange-500/25 text-orange-400"
      }`}
    >
      {good ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {value > 0 ? "+" : ""}
      {format(value)}
    </span>
  );
}

export function MetricDuelCard({
  label,
  championValue,
  recalibratedValue,
  championColor,
  recalibratedColor,
  format = (v: number) => v.toFixed(4),
  higherIsBetter = true,
}: {
  label: string;
  championValue: number;
  recalibratedValue: number;
  championColor: string;
  recalibratedColor: string;
  format?: (v: number) => string;
  higherIsBetter?: boolean;
}) {
  const delta = recalibratedValue - championValue;
  const good = higherIsBetter ? delta > 0 : delta < 0;

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 transition-colors ${
        good ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-orange-500/15 bg-orange-500/[0.02]"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="text-center p-2 rounded-lg bg-muted/20">
          <p className="text-[10px] text-muted-foreground mb-1 flex items-center justify-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: championColor }} />
            Champion
          </p>
          <p className="text-lg font-bold font-mono text-muted-foreground">{format(championValue)}</p>
        </div>
        <div className={`text-center p-2 rounded-lg ${good ? "bg-emerald-500/10" : "bg-orange-500/8"}`}>
          <p className="text-[10px] text-muted-foreground mb-1 flex items-center justify-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: recalibratedColor }} />
            Recalibrated
          </p>
          <p className={`text-lg font-bold font-mono ${good ? "text-emerald-400" : "text-orange-400"}`}>
            {format(recalibratedValue)}
          </p>
        </div>
      </div>
      <div className="flex justify-center">
        <DeltaChip value={delta} higherIsBetter={higherIsBetter} format={format} />
      </div>
    </div>
  );
}
