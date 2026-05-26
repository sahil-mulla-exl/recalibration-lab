import { Card } from "@/components/ui/card";
import { INGESTION_DATASETS } from "@/config/datasets";
import { SeverityChip } from "./SeverityChip";

type MissingStripCardProps = {
  feature: string;
  trainMissingPct: number;
  newMissingPct: number;
  deltaPp: number;
};

export function MissingStripCard({ feature, trainMissingPct, newMissingPct, deltaPp }: MissingStripCardProps) {
  const severity = deltaPp > 10 ? "large" : deltaPp > 5 ? "medium" : "stable";
  return (
    <Card className="p-3">
      <div className="text-xs font-medium">{feature}</div>
      <div className="text-xs text-muted-foreground mt-1">
        {INGESTION_DATASETS.dev_data.label} {trainMissingPct.toFixed(3)}% → {INGESTION_DATASETS.new_data.label} {newMissingPct.toFixed(3)}%
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="text-sm font-semibold">{deltaPp >= 0 ? "+" : ""}{deltaPp.toFixed(3)} pp</div>
        <SeverityChip severity={severity} />
      </div>
    </Card>
  );
}
