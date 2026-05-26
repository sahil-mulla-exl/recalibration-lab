import { Badge } from "@/components/ui/badge";

type RatingBadgeProps = { label: string };

export function RatingBadge({ label }: RatingBadgeProps) {
  const normalized = label.toLowerCase();
  const cls =
    normalized.includes("decline") || normalized.includes("large")
      ? "bg-red-500/10 text-red-700 border-red-500/30"
      : normalized.includes("watch") || normalized.includes("medium")
      ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
      : "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
  return <Badge className={cls}>{label}</Badge>;
}
