import { createContext, useContext, useState, useEffect, useCallback } from "react";

// ── Persisted state hook ──────────────────────────────────────────────────────
// Reads initial value from localStorage; writes back on every change.
// Falls back to `defaultValue` when nothing is stored or JSON.parse fails.
type SetStateAction<T> = T | ((prev: T) => T);

export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, (v: SetStateAction<T>) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setAndPersist = useCallback(
    (value: SetStateAction<T>) => {
      setState((prev) => {
        const next =
          typeof value === "function"
            ? (value as (p: T) => T)(prev)
            : value;
        try {
          if (next === null || next === undefined) {
            localStorage.removeItem(key);
          } else {
            localStorage.setItem(key, JSON.stringify(next));
          }
        } catch {
          // quota exceeded or private browsing — silently ignore
        }
        return next;
      });
    },
    [key]
  );

  return [state, setAndPersist];
}

// All localStorage keys used by the app — kept in one place so resets are easy.
export const RCL_STATE_KEYS = [
  "rcl:sessionId",
  "rcl:step",
  "rcl:selectedModel",
  "rcl:inventoryModels",
  "rcl:inventoryConfigs",
  "rcl:filesLoaded",
  "rcl:driftResult",
  "rcl:evaluationResult",
  "rcl:recalibrationResult",
  "rcl:loadedFiles",
  "rcl:reproDone",
  "rcl:targetVariable",
  "rcl:outcomeVariable",
  "rcl:autoRunDrift",
  "rcl:dataProcessingResult",
  "rcl:selectedRecommendedAction",
  "rcl:diagOptimizationInput",
  "rcl:diagInterim1",
  "rcl:diagInterim2",
  "rcl:diagFinal",
  "rcl:diagActiveTab",
  "rcl:workflowRunId",
  "rcl:workflowPendingHitl",
  "rcl:workflowStatus",
] as const;

export function clearAllSessionState() {
  for (const key of RCL_STATE_KEYS) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

// ── Session context types ─────────────────────────────────────────────────────
export interface SessionState {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  step: number;
  setStep: (n: number) => void;
  selectedModel: Record<string, string> | null;
  setSelectedModel: (m: Record<string, string> | null) => void;
  driftResult: Record<string, unknown> | null;
  setDriftResult: (r: Record<string, unknown> | null) => void;
  evaluationResult: Record<string, unknown> | null;
  setEvaluationResult: (r: Record<string, unknown> | null) => void;
  recalibrationResult: Record<string, unknown> | null;
  setRecalibrationResult: (r: Record<string, unknown> | null) => void;
  filesLoaded: boolean;
  setFilesLoaded: (v: boolean) => void;
}

export const SessionContext = createContext<SessionState>({
  sessionId: null,
  setSessionId: () => {},
  step: 0,
  setStep: () => {},
  selectedModel: null,
  setSelectedModel: () => {},
  driftResult: null,
  setDriftResult: () => {},
  evaluationResult: null,
  setEvaluationResult: () => {},
  recalibrationResult: null,
  setRecalibrationResult: () => {},
  filesLoaded: false,
  setFilesLoaded: () => {},
});

export const useSession = () => useContext(SessionContext);
