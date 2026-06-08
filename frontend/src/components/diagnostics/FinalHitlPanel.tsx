import { useState } from "react";

import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";

import {
  GenAiTabSummary,
  pickGenAiInsight,
  useParsedGenAiInsight,
} from "@/components/diagnostics/GenAiInsightsPanel";
import { SignalGrid } from "@/components/diagnostics/SignalGrid";
import { DIAGNOSTIC_ACTION_MESSAGES, DIAGNOSTIC_FINAL_ACTIONS } from "@/config/diagnostics";
import type { SearchSpaceValue } from "@/config/recalibrationHp";
import { pickRecalibrationSection } from "@/lib/genaiInsightParse";

import type { DiagnosticActionId } from "@/types/diagnostics";

export type FinalDecisionOptions = {
  searchSpace?: SearchSpaceValue;
  cvFolds?: number;
};

type FinalHitlPanelProps = {
  recommendation: { action?: DiagnosticActionId; rationale?: string };
  report?: Record<string, unknown>;
  signals?: Record<string, unknown>;
  modelClass: string;
  optimizationMethodLabel?: string;
  onConfirm: (
    action: DiagnosticActionId,
    rationale: string,
    options?: FinalDecisionOptions,
  ) => void;
};

export function FinalHitlPanel({
  recommendation,
  report,
  signals,
  modelClass,
  optimizationMethodLabel,
  onConfirm,
}: FinalHitlPanelProps) {
  const allowedActions: DiagnosticActionId[] = ["recal_same_hp", "recal_with_hp_opt"];
  const recommended = recommendation.action ?? "recal_with_hp_opt";
  const defaultAction = allowedActions.includes(recommended) ? recommended : "recal_with_hp_opt";

  const [action, setAction] = useState<DiagnosticActionId>(defaultAction);
  const llmDecision = pickGenAiInsight(report, "recalibration_decision");
  const llmParsed = useParsedGenAiInsight(llmDecision);
  const llmRecommendation = pickRecalibrationSection(llmParsed, "recommended");
  const llmRationale =
    llmDecision?.status === "ok" && llmRecommendation?.trim()
      ? llmRecommendation.trim()
      : recommendation.rationale ?? "Confirmed diagnostic decision";

  const descriptions: Record<DiagnosticActionId, string> = {
    no_action: "Accept current model performance and continue unchanged.",
    recal_same_hp: DIAGNOSTIC_ACTION_MESSAGES.recal_same_hp.summary,
    recal_with_hp_opt: DIAGNOSTIC_ACTION_MESSAGES.recal_with_hp_opt.summary,
    model_redevelopment: "Trigger a full model rebuild when the concept shift is structural and recalibration alone is insufficient.",
  };

  return (
    <Card className="p-4 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Diagnostic decision</h3>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
        All diagnostics complete. Review the signal summary below, then select your recalibration approach before
        proceeding to the Recalibration Agent.
      </p>

      <GenAiTabSummary insight={llmDecision} title="AI decision summary" className="mt-4" />

      <SignalGrid signals={signals} embedded className="mt-4" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        {DIAGNOSTIC_FINAL_ACTIONS.filter((item) => allowedActions.includes(item.id)).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (!allowedActions.includes(item.id)) return;
              setAction(item.id);
            }}
            disabled={!allowedActions.includes(item.id)}
            className={`border rounded-lg px-3 py-3 text-left transition-colors ${
              action === item.id
                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
                : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            } ${!allowedActions.includes(item.id) ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50 dark:hover:bg-slate-800"}`}
          >
            <div className="font-medium text-sm">{item.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{descriptions[item.id]}</div>
            <div className="mt-2">
              {item.id === defaultAction ? (
                <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300">AI recommended</span>
              ) : (
                <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-300">Override</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {action === "recal_same_hp" && (
        <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-900 space-y-2">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">What happens next</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            {DIAGNOSTIC_ACTION_MESSAGES.recal_same_hp.detail}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Hyperparameters will be taken from the uploaded champion model ({modelClass}
            {optimizationMethodLabel ? ` · ${optimizationMethodLabel}` : ""}). The recalibration page will not show a
            hyperparameter search — the agent will re-fit and score holdouts automatically.
          </p>
        </div>
      )}

      {action === "recal_with_hp_opt" && (
        <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-slate-50 dark:bg-slate-900">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">What happens next</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            {DIAGNOSTIC_ACTION_MESSAGES.recal_with_hp_opt.detail}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Hyperparameter search space, cross-validation folds, and feature drops are configured on the Recalibration
            page before the agent runs. Model class and search method come from your inventory selection (
            <span className="font-medium">{modelClass}</span>
            {optimizationMethodLabel ? ` · ${optimizationMethodLabel}` : ""}).
          </p>
        </div>
      )}

      <div className="flex justify-end mt-3">
        <Button
          onClick={() => {
            onConfirm(action, llmRationale);
          }}
        >
          Proceed to Recalibration
        </Button>
      </div>
    </Card>
  );
}
