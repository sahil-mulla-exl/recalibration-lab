import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Zap, AlertTriangle, CheckCircle, GitBranch, Sliders, RotateCcw, Cpu, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DIAGNOSTIC_ACTION_MESSAGES, usesHyperparameterOptimization } from "@/config/diagnostics";
import {
  buildDefaultSpace,
  hpParamsForModel,
  mergeDiagnosticsSearchSpace,
  type SearchSpaceValue,
} from "@/config/recalibrationHp";
import { downloadFeatureListXlsx, downloadRecalibrationTrainingData } from "@/lib/download";
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
import { FeatureSelectionPanel } from "@/components/recalibration/FeatureSelectionPanel";
import {
  buildFeatureMetricsFromDrift,
  featurePassesFilters,
  type ScreenerFilter,
} from "@/lib/featureScreener";
import { ChartCard, ChartPlot } from "@/components/charts";
import {
  axisLabel,
  axisTick,
  axisTickSpacing,
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

type RecommendedActionId = "no_action" | "recal_simple" | "recal_opt" | "redevelop";
type OptimizationInput = {
  hpMethod: "random" | "bayesian" | "grid";
  cvFolds: number;
  searchSpace?: SearchSpaceValue;
};

export default function RecalibrationProgress() {
  const theme = useChartTheme();
  const [, navigate] = useLocation();
  const { sessionId, setStep, recalibrationResult, setRecalibrationResult, driftResult, selectedModel, setEvaluationResult } = useSession();
  const [selectedAction] = usePersistedState<RecommendedActionId>("rcl:selectedRecommendedAction", "recal_opt");
  const [dataProcessingResult] = usePersistedState<Record<string, unknown> | null>(
    "rcl:dataProcessingResult",
    null,
  );
  const [reproDone] = usePersistedState<boolean>("rcl:reproDone", false);
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
  const needsHpConfig = usesHyperparameterOptimization(selectedAction);
  const showBestHyperparameters = needsHpConfig;
  const problemType = String(selectedModel?.problem_type || "classification").toLowerCase().startsWith("reg")
    ? "regression"
    : "classification";

  const [drops, setDrops] = useState<string[]>([]);
  const [screenerFilters, setScreenerFilters] = useState<ScreenerFilter[]>([]);
  const [featuresConfirmed, setFeaturesConfirmed] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  // Model class is inherited from the model selected in inventory and cannot be changed during recalibration.
  const inheritedClass = (selectedModel?.model_class as string) || "XGBoost";
  const inventoryHpMethod = normalizeOptimizationMethod(selectedModel?.optimization_method);
  const inheritedClassMeta =
    MODEL_CLASSES.find((m) => m.id === inheritedClass) ??
    { id: inheritedClass, icon: <Cpu className="h-4 w-4" />, desc: "Inherited from model inventory" };
  const modelClass = inheritedClass;
  const [hpMethod, setHpMethod] = useState<OptimizationMethod | "none">(inventoryHpMethod);
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

  const metricsByFeature = useMemo(
    () => buildFeatureMetricsFromDrift(driftResult as Record<string, unknown> | null, modelFeatures),
    [driftResult, modelFeatures],
  );

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


  const handleCompleted = (r: unknown) => {
    const res = r as Record<string, unknown>;
    setResult(res);
    setRecalibrationResult(res);
    setRunning(false);
    setDone(true);
  };

  const trials = result?.trial_history as Array<{ trial: number; score: number; auc?: number }> | undefined;
  const trialData = trials?.map((t) => ({ trial: t.trial, score: Number((t.score ?? t.auc ?? 0).toFixed(4)) })) || [];
  const bestScore = Number((result?.best_hp_score ?? result?.best_hp_auc ?? 0) as number);

  const finalFeatures = useMemo(() => {
    const fromResult = (result?.features_used as string[]) || [];
    if (fromResult.length > 0) return fromResult;
    if (!modelFeatures.length) return [];
    const dropSet = new Set(drops);
    return modelFeatures.filter((f) => !dropSet.has(f));
  }, [result?.features_used, modelFeatures, drops]);

  const exportFinalFeatures = async () => {
    if (finalFeatures.length === 0 || !sessionId) return;
    try {
      setExportBusy(true);
      await downloadFeatureListXlsx(sessionId, finalFeatures, "final_feature_list.xlsx");
    } catch (err) {
      console.error(err);
    } finally {
      setExportBusy(false);
    }
  };

  const canDownloadRecalibrationDataset = Boolean(sessionId && reproDone);

  const exportRecalibrationDataset = async () => {
    if (!canDownloadRecalibrationDataset) return;
    try {
      setExportBusy(true);
      await downloadRecalibrationTrainingData(sessionId!);
    } catch (err) {
      console.error(err);
    } finally {
      setExportBusy(false);
    }
  };

  const confirmScreenerSelection = () => {
    if (screenerFilters.length > 0) {
      modelFeatures
        .filter(
          (f) =>
            !drops.includes(f) &&
            !featurePassesFilters(metricsByFeature[f], screenerFilters, "and"),
        )
        .forEach((f) => toggleDrop(f));
    }
    setFeaturesConfirmed(true);
  };
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

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

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
              <div>
                <h2 className="font-semibold text-sm">Feature Selection</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Uncheck any features you want to exclude from the recalibrated model; CSI color shows drift severity.
                </p>
                {featuresConfirmed && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5 font-medium">
                    Screener selection confirmed — {modelFeatures.length - drops.length} features kept for recalibration.
                  </p>
                )}
              </div>

              <FeatureSelectionPanel
                features={modelFeatures}
                drops={drops}
                csiMap={csiMap}
                metricsByFeature={metricsByFeature}
                screenerFilters={screenerFilters}
                onScreenerFiltersChange={setScreenerFilters}
                onConfirmScreener={confirmScreenerSelection}
                onToggleDrop={toggleDrop}
                onClearDrops={() => setDrops([])}
              />
            </Card>

            <Card className="p-5 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="font-semibold text-sm">Recalibration settings</h2>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={exportBusy || !canDownloadRecalibrationDataset}
                    title={
                      !reproDone
                        ? "Complete Data Processing first to build the recalibration training dataset"
                        : done
                          ? "Download combined Existing Train + New Train used for recalibration (includes new_score after run)"
                          : "Download combined Existing Train + New Train that will be used for recalibration"
                    }
                    onClick={() => void exportRecalibrationDataset()}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {exportBusy ? "Exporting…" : "Final recalibration dataset"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={finalFeatures.length === 0 || exportBusy || !sessionId}
                    onClick={() => void exportFinalFeatures()}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {exportBusy ? "Exporting…" : `Final Feature list (${finalFeatures.length})`}
                  </Button>
                </div>
              </div>

              {selectedAction === "recal_simple" && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-1">
                  <p className="text-xs font-semibold text-foreground">Hyperparameters</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {DIAGNOSTIC_ACTION_MESSAGES.recal_same_hp.detail} Values are read from the uploaded champion
                    .pkl file — no search grid is applied. Model class and search method are taken from inventory.
                  </p>
                </div>
              )}

              {needsHpConfig && (
              <p className="text-xs text-muted-foreground">
                Model class ({inheritedClass}) and search method ({inventoryHpMethod}) are inherited from inventory.
              </p>
              )}

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
                  disabled={running}
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
                  {running ? "Recalibrating…" : "Start recalibration"}
                </Button>
              </div>
            </div>

        {running && !done && sessionId && (
          <Card className="p-5">
            <h2 className="font-semibold text-sm mb-4">Recalibration Agent</h2>
            <AgentStepper sessionId={sessionId} agent="recalibration" onCompleted={handleCompleted} />
          </Card>
        )}

        {done && result && (
          <div className="space-y-5 border-t border-border/60 pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold text-sm">Recalibration results</h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <CheckCircle className="h-3.5 w-3.5" /> Model saved to session
            </span>
          </div>

          {/* Model / HP params */}
          <Card className="p-5">
            <h3 className="font-semibold text-sm mb-3">
              {showBestHyperparameters ? "Best Hyperparameters" : "Model Parameters"}
            </h3>
            {!showBestHyperparameters && (
              <p className="text-xs text-muted-foreground mb-3">
                {DIAGNOSTIC_ACTION_MESSAGES.recal_same_hp.summary}
              </p>
            )}
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
          {needsHpConfig && trialData.length > 1 && (
            <ChartCard
              title="Hyperparameter Tuning Trace"
              subtitle={`${trialData.length} trials · best: ${bestScore.toFixed(4)}`}
            >
              <ChartPlot style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trialData} margin={chartMargin.xyTitles}>
                    <CartesianGrid {...cartesianGrid(theme)} />
                    <XAxis
                      dataKey="trial"
                      tick={axisTick(theme)}
                      tickMargin={axisTickSpacing.x.tickMargin}
                      stroke={theme.axisLine}
                      label={axisLabel(theme, "Trial #", "insideBottom")}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={axisTick(theme)}
                      tickMargin={axisTickSpacing.y.tickMargin}
                      width={axisTickSpacing.y.width}
                      stroke={theme.axisLine}
                      label={axisLabel(
                        theme,
                        problemType === "regression" ? "Validation R²" : "Validation AUC",
                        "left",
                        { angle: -90, offset: 10 },
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
                      strokeWidth={theme.plot.lineStrokeWidth}
                      fill={theme.series.newFill}
                      fillOpacity={theme.plot.areaFillOpacity}
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
                setEvaluationResult(null);
                setStep(5);
                navigate("/evaluation");
              }}
              className="gap-2"
            >
              Proceed to Evaluation <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          </div>
        )}

      </motion.div>
    </div>
  );
}
