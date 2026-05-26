import { Badge } from "@/components/ui/badge";

type SeverityChipProps = { severity: string };

const classes: Record<string, string> = {
  stable: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  large: "bg-red-500/10 text-red-700 border-red-500/30",
  significant_decline: "bg-red-500/10 text-red-700 border-red-500/30",
  weakened: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  improved: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
};

export function SeverityChip({ severity }: SeverityChipProps) {
  return <Badge className={classes[severity] ?? ""}>{severity.replaceAll("_", " ")}</Badge>;
}
