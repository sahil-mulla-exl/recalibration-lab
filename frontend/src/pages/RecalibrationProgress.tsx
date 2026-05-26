import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Zap, AlertTriangle, CheckCircle, Cpu, GitBranch, Sliders, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DIAGNOSTIC_ACTION_MESSAGES } from "@/config/diagnostics";
import {
  buildDefaultSpace,
  hpParamsForModel,
  mergeDiagnosticsSearchSpace,
  type SearchSpaceValue,
} from "@/config/recalibrationHp";
import {
  configureRecalibration,
  normalizeOptimizationMethod,
  runAgent,
  type OptimizationMethod,
} from "@/services/api";
import { usePersistedState, useSession } from "@/contexts/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AgentStepper } from "@/components/AgentStepper";
import { ChartCard, ChartPlot } from "@/components/charts";
import {
  axisLabel,
  axisTick,
  cartesianGrid,
  chartMargin,
  chartTooltipProps,
  useChartTheme,
} from "@/lib/chartTheme";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

const MODEL_CLASSES = [
  { id: "XGBoost", icon: <Zap className="h-4 w-4" />, desc: "Gradient boosted trees" },
  { id: "LightGBM", icon: <GitBranch className="h-4 w-4" />, desc: "Leaf-wise growth" },
  { id: "Logistic", icon: <Sliders className="h-4 w-4" />, desc: "Logistic regression" },
];

const HP_METHODS = [
  { id: "random",   label: "Random Search",   desc: "30 i.i.d. trials" },
  { id: "bayesian", label: "Bayesian Search", desc: "TPE-style adaptive" },
  { id: "grid",     label: "Grid Search",     desc: "Exhaustive sweep" },
];

type RecommendedActionId = "no_action" | "recal_simple" | "recal_opt" | "redevelop";
type OptimizationInput = {
  hpMethod: "random" | "bayesian" | "grid";
  cvFolds: number;
  searchSpace?: SearchSpaceValue;
};

// Arc gauge component
function ArcGauge({ value, max, color, size = 96 }: { value: number; max: number; color: string; size?: number }) {
  const r = (size / 2) - 10;
  const cx = size / 2, cy = size / 2;
  const circumference = Math.PI * r;
  const pct = Math.min(Math.max(value / max, 0), 1);
  return (
    <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`}>
      <path d={`M 10 ${cy} A ${r} ${r} 0 0 1 ${size - 10} ${cy}`} fill="none" stroke="#1e2a3a" strokeWidth={7} strokeLinecap="round" />
      <path d={`M 10 ${cy} A ${r} ${r} 0 0 1 ${size - 10} ${cy}`} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - pct)} />
      <text x={cx} y={cy + 10} textAnchor="middle" fill={color} fontSize={14} fontWeight="700" fontFamily="monospace">
        {value.toFixed(4)}
      </text>
    </svg>
  );
}

// CSI tier helpers
const csiColor = (v: number) => v >= 0.25 ? "#f97316" : v >= 0.10 ? "#facc15" : "#34d399";
const csiText = (v: number) => v >= 0.25 ? "text-orange-400" : v >= 0.10 ? "text-yellow-400" : "text-emerald-400";
const csiBg = (v: number, dropped: boolean) =>
  dropped
    ? "bg-muted/10 border-border/30 opacity-40"
    : v >= 0.25 ? "bg-orange-500/8 border-orange-500/25 hover:border-orange-500/50"
    : v >= 0.10 ? "bg-yellow-500/8 border-yellow-500/20 hover:border-yellow-500/40"
    : "bg-card border-border hover:border-primary/30";

export default function RecalibrationProgress() {
  const theme = useChartTheme();
  const [, navigate] = useLocation();
  const { sessionId, setStep, recalibrationResult, setRecalibrationResult, driftResult, selectedModel, setEvaluationResult } = useSession();
  const [selectedAction] = usePersistedState<RecommendedActionId>("rcl:selectedRecommendedAction", "recal_opt");
  const [dataProcessingResult] = usePersistedState<Record<string, unknown> | null>(
    "rcl:dataProcessingResult",
    null,
  );
  const [optimizationInput] = usePersistedState<OptimizationInput>(
    "rcl:diagOptimizationInput",
    { hpMethod: "bayesian", cvFolds: 5, searchSpace: {} }
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(!!recalibrationResult);
  const [result, setResult] = useState<Record<string, unknown> | null>(recalibrationResult);
  const [skipConfig, setSkipConfig] = useState(() => {
    try {
      return localStorage.getItem("rcl:autoStartRecalibration") === "true";
    } catch {
      return false;
    }
  });
  const autoStartedRef = useRef(false);
  const needsHpConfig = selectedAction === "recal_opt" || selectedAction === "redevelop";
  const showConfig = !running && !done && !skipConfig;
  const problemType = String(selectedModel?.problem_type || "classification").toLowerCase().startsWith("reg")
    ? "regression"
    : "classification";

  const [drops, setDrops] = useState<string[]>([]);
  // Model class is inherited from the model selected in inventory and cannot be changed during recalibration.
  const inheritedClass = (selectedModel?.model_class as string) || "XGBoost";
  const inventoryHpMethod = normalizeOptimizationMethod(selectedModel?.optimization_method);
  const inheritedClassMeta =
    MODEL_CLASSES.find((m) => m.id === inheritedClass) ??
    { id: inheritedClass, icon: <Cpu className="h-4 w-4" />, desc: "Inherited from model inventory" };
  const modelClass = inheritedClass;
  const [hpMethod, setHpMethod] = useState<OptimizationMethod>(inventoryHpMethod);
  const [cvFolds, setCvFolds] = useState(3);

  useEffect(() => {
    setHpMethod(inventoryHpMethod);
  }, [inventoryHpMethod]);

  const [sessionFeatures, setSessionFeatures] = useState<string[]>([]);

  const modelFeatures = useMemo(() => {
    const fromRepro = (dataProcessingResult?.model_features_used as string[]) || [];
    const fromRecal = (recalibrationResult?.features_used as string[]) || [];
    if (fromRepro.length > 0) return fromRepro;
    if (fromRecal.length > 0) return fromRecal;
    if (sessionFeatures.length > 0) return sessionFeatures;
    return [];
  }, [dataProcessingResult, recalibrationResult, sessionFeatures]);

  useEffect(() => {
    if (!sessionId || modelFeatures.length > 0) return;
    fetch(`/api/session/${sessionId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { model_features?: string[] } | null) => {
        if (Array.isArray(data?.model_features) && data.model_features.length > 0) {
          setSessionFeatures(data.model_features);
        }
      })
      .catch(() => undefined);
  }, [sessionId, modelFeatures.length]);

  const hpParams = hpParamsForModel(inheritedClass);
  const [searchSpace, setSearchSpace] = useState<SearchSpaceValue>(() => buildDefaultSpace(inheritedClass));
  useEffect(() => { setSearchSpace(buildDefaultSpace(inheritedClass)); }, [inheritedClass]);

  const updateRange = (name: string, side: "min" | "max", raw: string) => {
    const v = raw === "" ? undefined : Number(raw);
    setSearchSpace((s) => ({ ...s, [name]: { ...s[name], [side]: v } }));
  };
  const toggleChoice = (name: string, opt: string) =>
    setSearchSpace((s) => {
      const cur = s[name]?.selected ?? [];
      const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
      return { ...s, [name]: { selected: next } };
    });
  const resetSearchSpace = () => setSearchSpace(buildDefaultSpace(inheritedClass));

  const diagnosticsSearchSpace = () =>
    mergeDiagnosticsSearchSpace(buildDefaultSpace(inheritedClass), optimizationInput.searchSpace);

  const modelFeatureSet = useMemo(() => new Set(modelFeatures), [modelFeatures]);

  const highCsiVars = Object.entries((driftResult?.csi_results || {}) as Record<string, number>)
    .filter(([k, v]) => v >= 0.30 && (modelFeatureSet.size === 0 || modelFeatureSet.has(k)))
    .map(([k]) => k);

  const csiMap = (driftResult?.csi_results || {}) as Record<string, number>;

  const toggleDrop = (feat: string) =>
    setDrops((prev) => prev.includes(feat) ? prev.filter((f) => f !== feat) : [...prev, feat]);

  useEffect(() => {
    if (selectedAction === "recal_opt") {
      setSearchSpace(diagnosticsSearchSpace());
      setHpMethod(inventoryHpMethod);
      setCvFolds(optimizationInput.cvFolds ?? 5);
      setRunning(false);
    }
  }, [selectedAction, inheritedClass, inventoryHpMethod, optimizationInput.cvFolds]);

  const startAgent = async (override?: {
    drops: string[];
    hpMethod: OptimizationMethod | "none";
    cvFolds: number;
    searchSpace?: SearchSpaceValue;
  }) => {
    if (!sessionId) return;
    const effectiveDrops = override?.drops ?? drops;
    const effectiveHpMethod = override?.hpMethod ?? hpMethod;
    const effectiveCvFolds = override?.cvFolds ?? cvFolds;
    const effectiveSearchSpace =
      override?.searchSpace ??
      (selectedAction === "recal_opt" ? diagnosticsSearchSpace() : searchSpace);
    setDrops(effectiveDrops);
    setHpMethod(effectiveHpMethod);
    setCvFolds(effectiveCvFolds);
    setSearchSpace(effectiveSearchSpace);
    await configureRecalibration(
      sessionId,
      effectiveDrops,
      modelClass,
      effectiveHpMethod,
      effectiveCvFolds,
      effectiveSearchSpace,
      selectedAction
    );
    setRunning(true);
    await runAgent(sessionId, "recalibration");
  };

  useEffect(() => {
    if (!skipConfig || autoStartedRef.current || !sessionId || done || running) return;
    if (selectedAction !== "recal_simple" && selectedAction !== "recal_opt") {
      setSkipConfig(false);
      try {
        localStorage.removeItem("rcl:autoStartRecalibration");
      } catch {
        // ignore
      }
      return;
    }
    autoStartedRef.current = true;
    try {
      localStorage.removeItem("rcl:autoStartRecalibration");
    } catch {
      // ignore
    }
    const effectiveHpMethod = selectedAction === "recal_opt" ? inventoryHpMethod : "none";
    const effectiveCvFolds = selectedAction === "recal_opt" ? (optimizationInput.cvFolds ?? 5) : 1;
    const effectiveSearchSpace =
      selectedAction === "recal_opt" ? diagnosticsSearchSpace() : {};
    void startAgent({
      drops: [],
      hpMethod: effectiveHpMethod,
      cvFolds: effectiveCvFolds,
      searchSpace: effectiveSearchSpace,
    }).catch(() => setSkipConfig(false));
  }, [
    skipConfig,
    sessionId,
    done,
    running,
    selectedAction,
    inventoryHpMethod,
    optimizationInput.cvFolds,
    inheritedClass,
  ]);

  const handleCompleted = (r: unknown) => {
    const res = r as Record<string, unknown>;
    setResult(res);
    setRecalibrationResult(res);
    setDone(true);
  };

  const trials = result?.trial_history as Array<{ trial: number; score: number; auc?: number }> | undefined;
  const trialData = trials?.map((t) => ({ trial: t.trial, score: Number((t.score ?? t.auc ?? 0).toFixed(4)) })) || [];
  const bestScore = Number((result?.best_hp_score ?? result?.best_hp_auc ?? 0) as number);
  const ootAuc = result?.oot_auc as number | undefined;
  const ootRmse = result?.oot_rmse as number | undefined;
  const ootR2 = result?.oot_r2 as number | undefined;
  const aucImprovement = problemType === "classification" && driftResult && ootAuc ? ootAuc - Number(driftResult.new_auc) : undefined;
  const rmseImprovement = problemType === "regression" && driftResult && ootRmse !== undefined
    ? Number(driftResult.new_rmse ?? 0) - ootRmse
    : undefined;

  return (
    <div className="w-full max-w-none space-y-6 overflow-x-hidden">
      <div>
        <Button variant="ghost" size="sm" className="text-muted-foreground mb-3 -ml-1" onClick={() => navigate("/post-ingestion")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Diagnostics
        </Button>
        <h1 className="text-2xl font-bold">Recalibration</h1>
        
      </div>

      {skipConfig && !running && !done && (
        <Card className="p-5 space-y-2">
          <p className="text-sm font-medium text-foreground">Starting recalibration agent…</p>
          {selectedAction === "recal_simple" && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {DIAGNOSTIC_ACTION_MESSAGES.recal_same_hp.summary}
            </p>
          )}
          {selectedAction === "recal_opt" && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {DIAGNOSTIC_ACTION_MESSAGES.recal_with_hp_opt.summary}
            </p>
          )}
        </Card>
      )}

      {/* ── CONFIG PHASE ── */}
      <AnimatePresence>
        {showConfig && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="space-y-5">

            {/* High-drift warning */}
            {highCsiVars.length > 0 && (
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
                className="rounded-2xl border border-orange-500/30 bg-gradient-to-r from-orange-500/10 to-transparent overflow-hidden">
                <div className="flex items-start gap-4 p-4">
                  <div className="h-10 w-10 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
                    <AlertTriangle className="h-5 w-5 text-orange-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-orange-400 mb-1">High-drift variables detected</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      {highCsiVars.join(", ")} — CSI ≥ 0.30, likely to hurt out-of-time stability.
                    </p>
                    <Button size="sm" variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10 text-xs h-7"
                      onClick={() => setDrops(highCsiVars)}>
                      Auto-select {highCsiVars.length} for Drop
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Feature selection grid */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-sm">Feature Selection</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">CSI scores shown — click to toggle drop</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground">
                    <span className="text-foreground font-semibold">{modelFeatures.length - drops.length}</span> / {modelFeatures.length} retained
                  </span>
                  {drops.length > 0 && (
                    <button onClick={() => setDrops([])} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {modelFeatures.length === 0 && (
                  <p className="text-sm text-muted-foreground col-span-2 py-4 text-center">
                    No model features found. Upload a .pkl and complete data processing first.
                  </p>
                )}
                {modelFeatures.map((feat) => {
                  const csi = csiMap[feat] || 0;
                  const isDrop = drops.includes(feat);
                  return (
                    <button
                      key={feat}
                      onClick={() => toggleDrop(feat)}
                      className={`relative flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-all ${csiBg(csi, isDrop)}`}
                    >
                      {/* CSI bar background */}
                      {csi > 0 && !isDrop && (
                        <div className="absolute left-0 top-0 bottom-0 rounded-l-lg" style={{
                          width: `${Math.min(csi / 0.5, 1) * 100}%`,
                          background: `${csiColor(csi)}0f`,
                        }} />
                      )}
                      <div className="relative flex-1 flex items-center justify-between gap-2">
                        <span className={`text-xs truncate ${isDrop ? "line-through text-muted-foreground/40" : "font-medium"}`}>{feat}</span>
                        {csi > 0 && (
                          <span className={`text-[10px] font-mono shrink-0 ${isDrop ? "text-muted-foreground/30" : csiText(csi)}`}>
                            {csi.toFixed(2)}
                          </span>
                        )}
                      </div>
                      {isDrop && (
                        <span className="relative text-[9px] uppercase font-semibold text-destructive/60 shrink-0">drop</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Model config */}
            <Card className="p-5 space-y-5">
              <h2 className="font-semibold text-sm">Model Configuration</h2>

              {/* Model class — locked, inherited from inventory */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Model Class</p>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted/40 border border-border text-muted-foreground">
                    Locked · from inventory
                  </span>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl border border-primary/40 bg-primary/5 ring-1 ring-primary/20">
                  <div className="h-9 w-9 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
                    {inheritedClassMeta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary">{inheritedClassMeta.id}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {inheritedClassMeta.desc} · inherited from {selectedModel?.model_name || selectedModel?.model_id || "selected model"}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground/80 mt-2">
                  Recalibration must use the same algorithm as the original model. To change the model class, choose a different model from the inventory.
                </p>
              </div>

              {selectedAction === "recal_simple" && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-1">
                  <p className="text-xs font-semibold text-foreground">Hyperparameters</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {DIAGNOSTIC_ACTION_MESSAGES.recal_same_hp.detail} Values are read from the uploaded champion
                    .pkl file — no search grid is applied.
                  </p>
                </div>
              )}

              {/* HP method — only when optimisation is enabled */}
              {needsHpConfig && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Search Method</p>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted/40 border border-border text-muted-foreground">
                    Default · from inventory
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {HP_METHODS.map((m) => (
                    <button key={m.id} onClick={() => setHpMethod(m.id as OptimizationMethod)}
                      className={`flex flex-col items-start gap-2 p-3 rounded-xl border transition-all ${
                        hpMethod === m.id
                          ? "bg-primary/10 border-primary/50 ring-1 ring-primary/30"
                          : "bg-muted/10 border-border hover:border-primary/30"
                      }`}>
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${hpMethod === m.id ? "bg-primary/20 text-primary" : "bg-muted/30 text-muted-foreground"}`}>
                        <Cpu className="h-3.5 w-3.5" />
                      </div>
                      <div className="text-left">
                        <p className={`text-xs font-semibold ${hpMethod === m.id ? "text-primary" : ""}`}>{m.label}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">{m.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              )}

              {/* Hyperparameter search space (per technique) */}
              {needsHpConfig && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    Hyperparameter Search Space
                    <span className="ml-2 normal-case tracking-normal text-foreground/60">· {inheritedClass}</span>
                  </p>
                  <button
                    onClick={resetSearchSpace}
                    className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <RotateCcw className="h-3 w-3" />Reset to defaults
                  </button>
                </div>
                <div className="rounded-xl border border-border bg-muted/15 divide-y divide-border/60">
                  {hpParams.map((p) => (
                    <div key={p.name} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center px-3 py-2.5">
                      <div className="md:col-span-5">
                        <p className="text-xs font-mono font-semibold">{p.label}</p>
                        {p.hint && <p className="text-[10px] text-muted-foreground">{p.hint}</p>}
                      </div>
                      {p.kind === "range" ? (
                        <div className="md:col-span-7 flex items-center gap-2">
                          <div className="relative flex-1">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] uppercase text-muted-foreground tracking-wider">min</span>
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
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] uppercase text-muted-foreground tracking-wider">max</span>
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
                          <span className="hidden md:block text-[10px] text-muted-foreground/60 font-mono w-20 text-right shrink-0">
                            range [{p.min}, {p.max}]
                          </span>
                        </div>
                      ) : (
                        <div className="md:col-span-7 flex flex-wrap gap-1.5">
                          {p.options.map((opt) => {
                            const sel = (searchSpace[p.name]?.selected ?? []).includes(opt);
                            return (
                              <button
                                key={opt}
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
                <p className="text-[11px] text-muted-foreground/80 mt-2">
                  These ranges are sampled by the {hpMethod === "grid" ? "grid" : hpMethod === "bayesian" ? "Bayesian" : "random"} search during tuning.
                </p>
              </div>
              )}

              {/* CV folds slider */}
              {needsHpConfig && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Cross-Validation Folds</p>
                  <span className="text-sm font-bold font-mono text-primary">{cvFolds}</span>
                </div>
                <div className="relative">
                  <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((cvFolds - 2) / 8) * 100}%` }} />
                  </div>
                  <input type="range" min={2} max={10} step={1} value={cvFolds}
                    onChange={(e) => setCvFolds(Number(e.target.value))}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer h-2" />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
                  <span>2 (fast)</span><span>5</span><span>10 (thorough)</span>
                </div>
              </div>
              )}
            </Card>

            <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/5 to-transparent overflow-hidden">
              <div className="flex items-center gap-5 p-5">
                <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Model</p>
                    <p className="font-semibold mt-0.5">{modelClass}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Features</p>
                    <p className="font-semibold mt-0.5">{modelFeatures.length - drops.length} <span className="text-muted-foreground font-normal text-xs">of {modelFeatures.length}</span></p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">HP strategy</p>
                    <p className="font-semibold mt-0.5">
                      {selectedAction === "recal_simple"
                        ? "From uploaded .pkl"
                        : `${hpMethod} · ${cvFolds}-fold`}
                    </p>
                  </div>
                </div>
                <Button
                  className="gap-2 shrink-0"
                  onClick={() =>
                    void startAgent({
                      drops,
                      hpMethod,
                      cvFolds,
                      searchSpace: needsHpConfig ? searchSpace : {},
                    })
                  }
                >
                  <Zap className="h-4 w-4" />
                  Start recalibration
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── RUNNING PHASE ── */}
      {running && !done && sessionId && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-5">
            <h2 className="font-semibold text-sm mb-4">Recalibration Agent</h2>
            <AgentStepper sessionId={sessionId} agent="recalibration" onCompleted={handleCompleted} />
          </Card>
        </motion.div>
      )}

      {/* ── DONE PHASE ── */}
      {done && result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

          {/* Hero KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 to-transparent p-5 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Best HP {problemType === "regression" ? "R2" : "AUC"}
              </p>
              <ArcGauge value={bestScore} max={1} color="#FB4E0B" size={96} />
              <p className="text-xs text-muted-foreground mt-1">CV best trial</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/10 to-transparent p-5 text-center">
              {problemType === "regression" ? (
                <>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">OOT R2</p>
                  <ArcGauge value={ootR2 ?? 0} max={1} color="#34d399" size={96} />
                  <p className="text-xs text-muted-foreground mt-1">Out-of-time holdout</p>
                </>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">OOT AUC</p>
                  <ArcGauge value={ootAuc ?? 0} max={1} color="#34d399" size={96} />
                  <p className="text-xs text-muted-foreground mt-1">Out-of-time holdout</p>
                </>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 flex flex-col justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Summary</p>
                <div className="space-y-2.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Features used</span>
                    <span className="font-mono font-semibold">{String(result.n_features ?? modelFeatures.length - drops.length)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">HP trials</span>
                    <span className="font-mono font-semibold">{trialData.length || "30"}</span>
                  </div>
                  {aucImprovement !== undefined && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">vs. degraded AUC</span>
                      <span className={`font-mono font-semibold ${aucImprovement > 0 ? "text-emerald-400" : "text-orange-400"}`}>
                        {aucImprovement > 0 ? "+" : ""}{(aucImprovement * 100).toFixed(2)} pp
                      </span>
                    </div>
                  )}
                  {rmseImprovement !== undefined && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">RMSE improvement</span>
                      <span className={`font-mono font-semibold ${rmseImprovement > 0 ? "text-emerald-400" : "text-orange-400"}`}>
                        {rmseImprovement > 0 ? "+" : ""}{rmseImprovement.toFixed(4)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 text-emerald-400 text-xs font-medium">
                <CheckCircle className="h-3.5 w-3.5" />Model saved to session
              </div>
            </div>
          </div>

          {/* Best params */}
          <Card className="p-5">
            <h3 className="font-semibold text-sm mb-3">Best Hyperparameters</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries((result.best_params as Record<string, unknown>) || {}).map(([k, v]) => (
                <div key={k} className="bg-muted/20 border border-border rounded-lg px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</p>
                  <p className="text-sm font-mono font-semibold mt-0.5">{String(v)}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* HP tuning trace — area chart */}
          {trialData.length > 0 && (
            <ChartCard
              title="Hyperparameter Tuning Trace"
              subtitle={`${trialData.length} trials · best: ${bestScore.toFixed(4)}`}
            >
              <ChartPlot style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trialData} margin={chartMargin.labeledLeft}>
                    <CartesianGrid {...cartesianGrid(theme)} />
                    <XAxis
                      dataKey="trial"
                      tick={axisTick(theme)}
                      stroke={theme.axisLine}
                      label={axisLabel(theme, "Trial #", "insideBottom", { offset: -4 })}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={axisTick(theme)}
                      stroke={theme.axisLine}
                      label={axisLabel(
                        theme,
                        problemType === "regression" ? "Validation R²" : "Validation AUC",
                        "insideLeft",
                        { angle: -90, offset: 8 },
                      )}
                    />
                    <Tooltip formatter={(v: number) => v.toFixed(4)} {...chartTooltipProps(theme, { cursor: "line" })} />
                    {Number.isFinite(bestScore) && (
                      <ReferenceLine
                        y={bestScore}
                        stroke={theme.series.new}
                        strokeDasharray="4 4"
                        label={{ value: `Best ${bestScore.toFixed(4)}`, position: "right", fontSize: 10, fill: theme.series.new }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke={theme.series.new}
                      strokeWidth={1.5}
                      fill={theme.series.newFill}
                      fillOpacity={0.25}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartPlot>
            </ChartCard>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => {
                // Explicit proceed click should always trigger a fresh evaluation run.
                setEvaluationResult(null);
                setStep(5);
                navigate("/evaluation");
              }}
              className="gap-2"
            >
              Proceed to Evaluation <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
