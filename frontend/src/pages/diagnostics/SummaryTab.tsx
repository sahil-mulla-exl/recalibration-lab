import { FinalHitlPanel, type FinalDecisionOptions } from "@/components/diagnostics/FinalHitlPanel";

import type { DiagnosticActionId } from "@/types/diagnostics";



type SummaryTabProps = {

  report: Record<string, unknown>;

  modelClass: string;

  optimizationMethodLabel?: string;

  onConfirm: (

    action: DiagnosticActionId,

    rationale: string,

    options?: FinalDecisionOptions,

  ) => void;

};



export function SummaryTab({ report, modelClass, optimizationMethodLabel, onConfirm }: SummaryTabProps) {

  const recommendation = (report.recommendation ?? {}) as {

    action?: DiagnosticActionId;

    rationale?: string;

  };



  return (

    <FinalHitlPanel

      recommendation={recommendation}

      report={report}

      signals={(report.signal_grid ?? {}) as Record<string, unknown>}

      modelClass={modelClass}

      optimizationMethodLabel={optimizationMethodLabel}

      onConfirm={onConfirm}

    />

  );

}

