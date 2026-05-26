import { Badge } from "@/components/ui/badge";

type DeltaPillProps = { value: number; suffix?: string };

export function DeltaPill({ value, suffix = "" }: DeltaPillProps) {
  const cls = value > 0 ? "bg-red-500/10 text-red-700" : value < 0 ? "bg-emerald-500/10 text-emerald-700" : "";
  const text = `${value >= 0 ? "+" : ""}${value.toFixed(3)}${suffix}`;
  return <Badge className={cls}>{text}</Badge>;
}
