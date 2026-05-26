import { cn } from "@/utils/utils";
import { Card } from "@/components/ui/card";

type SignalGridProps = {
  signals?: Record<string, unknown>;
  /** When true, render compact tiles inside Diagnostic decision (no nested Card per metric). */
  embedded?: boolean;
  className?: string;
};



export function SignalGrid({ signals, embedded = false, className }: SignalGridProps) {

  const LABELS: Record<string, string> = {

    target_drift_pp: "Target drift (pp)",

    feature_csi_large_count: "Feature CSI large",

    missing_critical_count: "Missing critical",

    iv_significant_decline_count: "IV significant decline",

    monotonicity_break_count: "Monotonicity breaks",

    auc_drop_pp: "AUC drop (pp)",

    ks_drop_pp: "KS drop (pp)",

    score_psi: "Score PSI",

    shap_composite: "SHAP composite",

  };

  const ORDER = [

    "target_drift_pp",

    "feature_csi_large_count",

    "missing_critical_count",

    "iv_significant_decline_count",

    "monotonicity_break_count",

    "auc_drop_pp",

    "ks_drop_pp",

    "score_psi",

    "shap_composite",

  ];

  const entries = ORDER.filter((k) => k in (signals ?? {})).map((k) => [k, (signals ?? {})[k]] as const);

  if (!entries.length) return null;

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3", className)}>
      {entries.map(([key, value]) => {
        const label = LABELS[key] ?? key.replaceAll("_", " ");
        const display =
          typeof value === "number" ? value.toFixed(3) : String(value);
        const tileClass = embedded
          ? "p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/80 dark:bg-slate-900/80"
          : "p-3 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950";

        const content = (
          <>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {label}
            </div>
            <div className="text-sm font-semibold mt-1 capitalize text-gray-900 dark:text-gray-100">
              {display}
            </div>
          </>
        );

        return embedded ? (
          <div key={key} className={tileClass}>
            {content}
          </div>
        ) : (
          <Card key={key} className={tileClass}>
            {content}
          </Card>
        );
      })}
    </div>
  );

}

