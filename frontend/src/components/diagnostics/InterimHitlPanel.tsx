import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DiagnosticActionId } from "@/types/diagnostics";

type InterimHitlPanelProps = {
  title: string;
  recommendation: string;
  recommendedAction: DiagnosticActionId;
  onConfirm: (action: DiagnosticActionId, rationale: string) => void;
};

const ACTIONS: { id: DiagnosticActionId; label: string }[] = [
  { id: "recal_with_hp_opt", label: "Continue diagnostics" },
  { id: "recal_same_hp", label: "Proceed to recalibration now" },
  { id: "no_action", label: "No recalibration" },
];

export function InterimHitlPanel({ title, recommendation, recommendedAction, onConfirm }: InterimHitlPanelProps) {
  const [action, setAction] = useState<DiagnosticActionId>(recommendedAction);
  const [rationale, setRationale] = useState("");
  return (
    <Card className="p-4 border-orange-500/30">
      <h4 className="font-semibold text-sm">{title}</h4>
      <p className="text-xs text-muted-foreground mt-1">{recommendation}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
        {ACTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAction(item.id)}
            className={`text-left border rounded-md px-3 py-2 text-xs ${action === item.id ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30" : "border-border"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <Input
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Rationale (required if overriding recommendation)"
        />
        <Button onClick={() => onConfirm(action, rationale)} disabled={action !== recommendedAction && rationale.trim().length < 5}>
          Confirm
        </Button>
      </div>
    </Card>
  );
}
