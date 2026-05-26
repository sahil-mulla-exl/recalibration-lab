import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";

import { HpSearchSpaceEditor } from "@/components/recalibration/HpSearchSpaceEditor";

import { SignalGrid } from "@/components/diagnostics/SignalGrid";
import { DIAGNOSTIC_ACTION_MESSAGES, DIAGNOSTIC_FINAL_ACTIONS } from "@/config/diagnostics";

import { buildDefaultSpace, type SearchSpaceValue } from "@/config/recalibrationHp";

import type { DiagnosticActionId } from "@/types/diagnostics";



export type FinalDecisionOptions = {

  searchSpace?: SearchSpaceValue;

  cvFolds?: number;

};



type FinalHitlPanelProps = {

  recommendation: { action?: DiagnosticActionId; rationale?: string };

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

  signals,

  modelClass,

  optimizationMethodLabel,

  onConfirm,

}: FinalHitlPanelProps) {

  const allowedActions: DiagnosticActionId[] = ["recal_same_hp", "recal_with_hp_opt"];

  const recommended = recommendation.action ?? "recal_with_hp_opt";

  const defaultAction = allowedActions.includes(recommended) ? recommended : "recal_with_hp_opt";

  const [action, setAction] = useState<DiagnosticActionId>(defaultAction);

  const [searchSpace, setSearchSpace] = useState<SearchSpaceValue>(() => buildDefaultSpace(modelClass));

  const [cvFolds, setCvFolds] = useState(5);



  useEffect(() => {

    setSearchSpace(buildDefaultSpace(modelClass));

  }, [modelClass]);



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

      <SignalGrid signals={signals} embedded className="mt-4" />

      {recommendation.rationale ? (
        <div className="mt-4 rounded-lg border border-orange-200 dark:border-orange-800/50 bg-orange-50/60 dark:bg-orange-950/20 px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
          <span className="font-semibold text-orange-700 dark:text-orange-300">AI recommendation. </span>
          {recommendation.rationale}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">

        {DIAGNOSTIC_FINAL_ACTIONS.map((item) => (

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
        <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3 bg-slate-50 dark:bg-slate-900">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">What happens next</p>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              {DIAGNOSTIC_ACTION_MESSAGES.recal_with_hp_opt.detail}
            </p>
          </div>
          {optimizationMethodLabel && (
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Search method from inventory: <span className="font-medium">{optimizationMethodLabel}</span>
            </p>
          )}

          <HpSearchSpaceEditor

            modelClass={modelClass}

            searchSpace={searchSpace}

            onChange={setSearchSpace}

            compact

          />

          <div>

            <div className="flex items-center justify-between mb-1.5">

              <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Cross-validation folds</p>

              <span className="text-xs font-mono font-semibold text-primary">{cvFolds}</span>

            </div>

            <input

              type="range"

              min={2}

              max={10}

              step={1}

              value={cvFolds}

              onChange={(e) => setCvFolds(Number(e.target.value))}

              className="w-full accent-primary"

            />

            <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400 mt-1">

              <span>2 (fast)</span>

              <span>5</span>

              <span>10 (thorough)</span>

            </div>

          </div>

        </div>

      )}



      <div className="flex justify-end mt-3">

        <Button

          onClick={() => {

            const options: FinalDecisionOptions | undefined =

              action === "recal_with_hp_opt"

                ? { searchSpace, cvFolds }

                : undefined;

            onConfirm(action, recommendation.rationale ?? "Confirmed diagnostic decision", options);

          }}

        >

          Proceed to Recalibration

        </Button>

      </div>

    </Card>

  );

}

