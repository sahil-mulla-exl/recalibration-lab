import { Card } from "@/components/ui/card";

type ShapFlagCardsProps = { flags?: Record<string, unknown> };

export function ShapFlagCards({ flags }: ShapFlagCardsProps) {
  if (!flags) return null;
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-sm">
        <span className="font-semibold mr-2">Composite:</span>
        <span className="capitalize">{String(flags.composite ?? "unknown")}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Card className="p-3">
        <div className="text-xs text-muted-foreground uppercase">Top feature set overlap %</div>
        <div className="text-lg font-semibold">
          {(Number(flags.feature_set_overlap ?? flags.jaccard ?? 0) * 100).toFixed(1)}%
        </div>
      </Card>
      <Card className="p-3">
        <div className="text-xs text-muted-foreground uppercase">Rank order shift</div>
        <div className="text-lg font-semibold">{String(flags.major_rank_shifts ?? "-")}</div>
        <div className="text-xs text-muted-foreground mt-1">Features moving beyond rank threshold</div>
      </Card>
      <Card className="p-3">
        <div className="text-xs text-muted-foreground uppercase">Importance concentration</div>
        <div className="text-lg font-semibold">{Number(flags.topk_mass_delta_pp ?? 0).toFixed(3)} pp</div>
        <div className="text-xs text-muted-foreground mt-1">
          Dev {Number(flags.topk_mass_dev_pct ?? 0).toFixed(3)}% vs new {Number(flags.topk_mass_new_pct ?? 0).toFixed(3)}%
        </div>
      </Card>
      </div>
    </div>
  );
}
