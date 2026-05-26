import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Upload, ChevronRight, Download, ChevronDown, Trash2 } from "lucide-react";
import {
  clearModelWorkflowState,
  normalizeOptimizationMethod,
  selectModel,
  uploadInventory,
  type ModelEntry,
  type OptimizationMethod,
} from "@/services/api";
import { usePersistedState, useSession } from "@/contexts/session";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

function ClassBadge({ cls }: { cls: string }) {
  const colors: Record<string, string> = {
    XGBoost: "bg-primary/15 text-primary border-primary/30",
    LightGBM: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    GBM: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    Logistic: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${colors[cls] || "bg-muted/40 text-muted-foreground border-border"}`}>
      {cls}
    </span>
  );
}

const TEMPLATE_HEADERS = [
  "model_name",
  "model_id",
  "problem_type",
  "model_class",
  "use_case",
  "owner",
  "deployment_date",
  "optimization_method",
];

const OPTIMIZATION_METHOD_LABELS: Record<OptimizationMethod, string> = {
  random: "Random Search",
  bayesian: "Bayesian Search",
  grid: "Grid Search",
};

function OptimizationMethodBadge({ method }: { method?: string }) {
  const normalized = normalizeOptimizationMethod(method);
  const colors: Record<OptimizationMethod, string> = {
    random: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
    bayesian: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    grid: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${colors[normalized]}`}>
      {OPTIMIZATION_METHOD_LABELS[normalized]}
    </span>
  );
}

const INVENTORY_TEMPLATE = [TEMPLATE_HEADERS.join(",")].join("\n");

const CONFIG_GROUPS = [
  { section: "Data Drift", options: ["PSI", "CSI", "IV", "WOE"] },
  { section: "Concept Drift", options: ["Target Shift"] },
  {
    section: "Performance",
    options: ["AUC", "KS", "GINI", "Calibration", "Lift/Gains", "RMSE", "MAE", "R2", "Feature Importance"],
  },
] as const;
type ConfigOption = (typeof CONFIG_GROUPS)[number]["options"][number];

function ConfigSelector({
  picked,
  onToggle,
}: {
  picked: ConfigOption[];
  onToggle: (option: ConfigOption) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = CONFIG_GROUPS
    .map((group) => ({
      ...group,
      options: group.options.filter((opt) => opt.toLowerCase().includes(normalizedQuery)),
    }))
    .filter((group) => group.options.length > 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 justify-between gap-2 w-full min-w-0">
          <span className="truncate">
            {picked.length > 0 ? picked.join(", ") : "Select metrics"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-2" align="start">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search metrics..."
          className="mb-2 h-8 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500"
        />
        <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
          {filteredGroups.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-1">No matching metrics.</p>
          )}
          {filteredGroups.map((group) => (
            <div key={group.section} className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {group.section}
              </p>
              <div className="space-y-1.5">
                {group.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={picked.includes(opt)}
                      onCheckedChange={() => onToggle(opt)}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function downloadTemplate() {
  const blob = new Blob([INVENTORY_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "model_inventory_template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ModelInventory() {
  const [, navigate] = useLocation();
  const {
    sessionId,
    setSelectedModel,
    setStep,
    setDriftResult,
    setEvaluationResult,
    setRecalibrationResult,
    setFilesLoaded,
  } = useSession();
  const [selecting, setSelecting] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [models, setModels] = usePersistedState<ModelEntry[]>("rcl:inventoryModels", []);
  const [selectedConfigs, setSelectedConfigs] = usePersistedState<Record<string, ConfigOption[]>>(
    "rcl:inventoryConfigs",
    {}
  );

  const handleSelect = async (model: ModelEntry) => {
    if (!sessionId) return;
    setSelecting(model.model_id);
    await selectModel(sessionId, model.model_id, model);
    setSelectedModel(model as unknown as Record<string, string>);
    setStep(1);
    navigate("/ingestion");
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    try {
      const result = await uploadInventory(file);
      if (result.schema_errors?.length > 0) {
        setUploadError(`Schema errors: ${result.schema_errors.map((err: { row: number; missing: string[] }) => `row ${err.row} missing ${err.missing.join("/")}`).join(", ")}`);
      }
      const nextModels = Array.isArray(result.models) ? result.models : [];
      setModels(nextModels);
      const allowedIds = new Set(nextModels.map((m: ModelEntry) => m.model_id));
      setSelectedConfigs((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([modelId]) => allowedIds.has(modelId)))
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload inventory");
      setModels([]);
      setSelectedConfigs({});
    }
  };

  const toggleConfig = (modelId: string, option: ConfigOption) => {
    setSelectedConfigs((prev) => {
      const current = prev[modelId] || [];
      const next = current.includes(option)
        ? current.filter((x) => x !== option)
        : [...current, option];
      return { ...prev, [modelId]: next };
    });
  };

  const clearUploadedInventory = async () => {
    if (sessionId) {
      try {
        await clearModelWorkflowState(sessionId);
      } catch {
        // Frontend reset still runs even if backend reset call fails.
      }
    }

    setSelectedModel(null);
    setStep(0);
    setFilesLoaded(false);
    setDriftResult(null);
    setEvaluationResult(null);
    setRecalibrationResult(null);

    [
      "rcl:loadedFiles",
      "rcl:reproDone",
      "rcl:targetVariable",
      "rcl:outcomeVariable",
      "rcl:autoRunDrift",
      "rcl:dataProcessingResult",
      "rcl:selectedRecommendedAction",
      "rcl:diagOptimizationInput",
    ].forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore storage errors in reset path.
      }
    });

    setUploadError("");
    setModels([]);
    setSelectedConfigs({});
    navigate("/");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Model Inventory</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Select a model to begin the assessment workflow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {models.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={clearUploadedInventory}
              title="Delete uploaded inventory"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5 mr-1.5" />Template
          </Button>
          <label className="cursor-pointer">
            <input type="file" accept=".csv" className="hidden" onChange={handleUpload} />
            <Button variant="outline" size="sm" asChild>
              <span><Upload className="h-3.5 w-3.5 mr-1.5" />Upload Inventory</span>
            </Button>
          </label>
        </div>
      </div>

      {uploadError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive">{uploadError}</div>
      )}

      {models.length === 0 ? (
        <div className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 text-sm text-gray-500 dark:text-gray-400">
          Upload an inventory CSV (using the template headers) to view models.
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm border-collapse">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[140px]">Model Name</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[110px]">Model ID</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[100px]">Problem Type</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[100px]">Model Class</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[130px]">Use Case</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[110px]">Owner</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[105px]">Deploy Date</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[150px]">Optimization</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[180px]">Configurations</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[90px]">Action</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model, rowIndex) => {
                  const picked = selectedConfigs[model.model_id] || [];
                  return (
                    <tr
                      key={model.model_id}
                      className={`align-top border-t border-gray-200 dark:border-gray-700 transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                        rowIndex % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800/50"
                      }`}
                    >
                      <td className="px-3 py-2 break-words">{model.model_name}</td>
                      <td className="px-3 py-2 font-mono text-xs break-all">{model.model_id}</td>
                      <td className="px-3 py-2 break-words">{model.problem_type || "-"}</td>
                      <td className="px-3 py-2">
                        <ClassBadge cls={model.model_class || ""} />
                      </td>
                      <td className="px-3 py-2 break-words">{model.use_case || "-"}</td>
                      <td className="px-3 py-2 break-words">{model.owner || "-"}</td>
                      <td className="px-3 py-2 break-words whitespace-nowrap">{model.deployment_date || "-"}</td>
                      <td className="px-3 py-2">
                        <OptimizationMethodBadge method={model.optimization_method} />
                      </td>
                      <td className="px-3 py-2">
                        <ConfigSelector picked={picked} onToggle={(opt) => toggleConfig(model.model_id, opt)} />
                        {picked.length > 0 && (
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            Metrics: {picked.join(", ")}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={selecting === model.model_id || picked.length === 0}
                          onClick={() => handleSelect(model)}
                          title={picked.length === 0 ? "Select at least one configuration metric first" : undefined}
                        >
                          {selecting === model.model_id ? "Initialising…" : "Start"}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
