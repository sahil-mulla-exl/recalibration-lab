import { RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  buildDefaultSpace,
  hpParamsForModel,
  type SearchSpaceValue,
} from "@/config/recalibrationHp";

type HpSearchSpaceEditorProps = {
  modelClass: string;
  searchSpace: SearchSpaceValue;
  onChange: (next: SearchSpaceValue) => void;
  compact?: boolean;
};

export function HpSearchSpaceEditor({
  modelClass,
  searchSpace,
  onChange,
  compact = false,
}: HpSearchSpaceEditorProps) {
  const hpParams = hpParamsForModel(modelClass);

  const updateRange = (name: string, side: "min" | "max", raw: string) => {
    const v = raw === "" ? undefined : Number(raw);
    onChange({ ...searchSpace, [name]: { ...searchSpace[name], [side]: v } });
  };

  const toggleChoice = (name: string, opt: string) => {
    const cur = searchSpace[name]?.selected ?? [];
    const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
    onChange({ ...searchSpace, [name]: { selected: next } });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className={`font-medium ${compact ? "text-xs" : "text-xs uppercase tracking-wider text-muted-foreground"}`}>
          Hyperparameter search space
          <span className="ml-1.5 normal-case tracking-normal text-foreground/70">· {modelClass}</span>
        </p>
        <button
          type="button"
          onClick={() => onChange(buildDefaultSpace(modelClass))}
          className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>
      <div className="rounded-xl border border-border bg-muted/15 divide-y divide-border/60">
        {hpParams.map((p) => (
          <div
            key={p.name}
            className={`grid grid-cols-1 gap-2 items-center px-3 ${compact ? "py-2" : "py-2.5 md:grid-cols-12 md:gap-3"}`}
          >
            <div className={compact ? "" : "md:col-span-5"}>
              <p className="text-xs font-mono font-semibold">{p.label}</p>
              {p.hint && <p className="text-[10px] text-muted-foreground">{p.hint}</p>}
            </div>
            {p.kind === "range" ? (
              <div className={`flex items-center gap-2 ${compact ? "" : "md:col-span-7"}`}>
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] uppercase text-muted-foreground tracking-wider">
                    min
                  </span>
                  <Input
                    type="number"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={searchSpace[p.name]?.min ?? ""}
                    onChange={(e) => updateRange(p.name, "min", e.target.value)}
                    className="h-8 text-xs font-mono pl-9"
                  />
                </div>
                <span className="text-muted-foreground/60 text-xs">→</span>
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] uppercase text-muted-foreground tracking-wider">
                    max
                  </span>
                  <Input
                    type="number"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={searchSpace[p.name]?.max ?? ""}
                    onChange={(e) => updateRange(p.name, "max", e.target.value)}
                    className="h-8 text-xs font-mono pl-9"
                  />
                </div>
              </div>
            ) : (
              <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "md:col-span-7"}`}>
                {p.options.map((opt) => {
                  const sel = (searchSpace[p.name]?.selected ?? []).includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleChoice(p.name, opt)}
                      className={`text-[11px] font-mono px-2 py-1 rounded-md border transition-colors ${
                        sel
                          ? "bg-primary/15 text-primary border-primary/40"
                          : "bg-card text-muted-foreground border-border hover:border-primary/30"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
