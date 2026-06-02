import { useEffect, useRef, useState, type ReactElement } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Package, CheckCircle, ArrowRight, ArrowLeft,
  FileCode, Database, Box, AlertTriangle, ShieldCheck,
  Plug, X, Loader2, Trash2, Check, ChevronsUpDown,
} from "lucide-react";
import { configureIngestionVariables, loadSamples, removeIngestionFile, runAgent, uploadFile } from "@/services/api";
import { useSession, usePersistedState } from "@/contexts/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AgentStepper } from "@/components/AgentStepper";
import { INGESTION_DATASETS } from "@/config/datasets";

interface SchemaCheck {
  match: boolean;
  common_cols?: number;
  missing_cols?: string[];
  extra_cols?: string[];
  dtype_mismatches?: { col: string; dev: string; new: string }[];
  target_in_dev?: boolean;
  target_in_new?: boolean;
  outcome_excluded_from_schema?: string;
  error?: string;
}

interface FileMeta {
  filename: string;
  size_kb: number;
  columns?: string[];
  rows?: number;
  cols?: number;
  numeric_cols?: number;
  cat_cols?: number;
  null_pct?: number;
  target_present?: boolean;
  target_rate?: number;
  model_class?: string;
  feature_count?: number;
  n_estimators?: number;
  schema_check?: SchemaCheck;
  error?: string;
}

type Section = "data" | "model" | "code" | "dictionary";

interface FileKind {
  id: string;
  label: string;
  ext: string;
  icon: ReactElement;
  desc: string;
  section: Section;
  optional?: boolean;
}

function SearchableVariableSelect({
  value,
  options,
  placeholder,
  onChange,
  allowNone = true,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (next: string) => void;
  allowNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full justify-between font-normal"
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search variable..." />
          <CommandList>
            <CommandEmpty>No variable found.</CommandEmpty>
            {allowNone && (
              <CommandItem
                key="__none__"
                value="None"
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                <Check className={`h-3.5 w-3.5 ${value === "" ? "opacity-100" : "opacity-0"}`} />
                None
              </CommandItem>
            )}
            {options.map((opt) => (
              <CommandItem
                key={opt}
                value={opt}
                onSelect={() => {
                  onChange(opt);
                  setOpen(false);
                }}
              >
                <Check className={`h-3.5 w-3.5 ${value === opt ? "opacity-100" : "opacity-0"}`} />
                {opt}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const FILE_KINDS: FileKind[] = [
  { id: "dev_data", label: INGESTION_DATASETS.dev_data.label, ext: ".parquet,.csv", icon: <Database className="h-4 w-4" />, desc: "Development dataset (parquet / csv)", section: "data" },
  { id: "new_data", label: INGESTION_DATASETS.new_data.label, ext: ".parquet,.csv", icon: <Database className="h-4 w-4" />, desc: "New scoring data (parquet / csv)", section: "data" },
  { id: "hold_data", label: INGESTION_DATASETS.hold_data.label, ext: ".parquet,.csv", icon: <Database className="h-4 w-4" />, desc: "Development validation / holdout sample (parquet / csv)", section: "data" },
  { id: "new_data_oos", label: INGESTION_DATASETS.new_data_oos.label, ext: ".parquet,.csv", icon: <Database className="h-4 w-4" />, desc: "New validation sample (parquet / csv)", section: "data" },
  { id: "model", label: "Model Object", ext: ".pkl", icon: <Box className="h-4 w-4" />, desc: "Serialized model (.pkl)", section: "model" },
  { id: "preprocess", label: "Preprocessing", ext: ".py", icon: <FileCode className="h-4 w-4" />, desc: "preprocess.py", section: "code" },
  { id: "features", label: "Feature Engineering", ext: ".py", icon: <FileCode className="h-4 w-4" />, desc: "feature_engineering.py", section: "code" },
  {
    id: "data_dictionary",
    label: "Data Dictionary",
    ext: ".csv,.xlsx,.xls",
    icon: <FileCode className="h-4 w-4" />,
    desc: "Variable descriptions (.csv / .xlsx)",
    section: "dictionary",
    optional: true,
  },
];

function StatPill({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warn" | "good" }) {
  const toneClass =
    tone === "warn"
      ? "border-orange-500/30 bg-orange-500/5 text-orange-300"
      : tone === "good"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
      : "border-border bg-muted/20 text-foreground";
  return (
    <div className={`rounded-md border px-2.5 py-1.5 text-[11px] flex flex-col leading-tight ${toneClass}`}>
      <span className="text-[10px] uppercase tracking-wider opacity-60">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

function SchemaCheckBadge({ check }: { check?: SchemaCheck }) {
  if (!check) return null;
  if (check.error) {
    return (
      <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5 text-xs text-orange-300 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Schema check failed: {check.error}</span>
      </div>
    );
  }
  if (check.match) {
    return (
      <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2.5 text-xs text-emerald-300 flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        <span>Schema matches dev sample · {check.common_cols ?? 0} shared columns · target column present in both</span>
      </div>
    );
  }
  // Mismatched
  return (
    <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5 text-xs text-orange-300 space-y-1">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Schema mismatch with dev sample
      </div>
      {!!check.missing_cols?.length && (
        <p className="font-mono text-[11px]">Missing in uploaded data: {check.missing_cols.slice(0, 4).join(", ")}{check.missing_cols.length > 4 ? ` (+${check.missing_cols.length - 4})` : ""}</p>
      )}
      {!!check.extra_cols?.length && (
        <p className="font-mono text-[11px]">Extra in uploaded data: {check.extra_cols.slice(0, 4).join(", ")}{check.extra_cols.length > 4 ? ` (+${check.extra_cols.length - 4})` : ""}</p>
      )}
      {!!check.dtype_mismatches?.length && (
        <p className="font-mono text-[11px]">
          {check.dtype_mismatches.length} dtype mismatch{check.dtype_mismatches.length > 1 ? "es" : ""}
          {check.dtype_mismatches[0] && `: ${check.dtype_mismatches[0].col} (${check.dtype_mismatches[0].dev}→${check.dtype_mismatches[0].new})`}
        </p>
      )}
      {check.target_in_dev !== check.target_in_new && (
        <p className="font-mono text-[11px]">Target column presence differs (dev: {String(check.target_in_dev)} · new: {String(check.target_in_new)})</p>
      )}
      {check.outcome_excluded_from_schema && (
        <p className="font-mono text-[11px]">
          Outcome column <span className="font-semibold">{check.outcome_excluded_from_schema}</span> is not required on this dataset
        </p>
      )}
    </div>
  );
}

// ── Popular databases for the "Connect DB" picker ────────────────────────
const DB_SOURCES = [
  { id: "postgres",   name: "PostgreSQL",      color: "#336791", logo: "🐘", desc: "Open-source SQL" },
  { id: "snowflake",  name: "Snowflake",       color: "#29B5E8", logo: "❄",  desc: "Cloud data warehouse" },
  { id: "bigquery",   name: "Google BigQuery", color: "#4285F4", logo: "🔷", desc: "Serverless warehouse" },
  { id: "databricks", name: "Databricks",      color: "#FF3621", logo: "🧱", desc: "Lakehouse platform" },
  { id: "redshift",   name: "Amazon Redshift", color: "#8C4FFF", logo: "🟥", desc: "AWS warehouse" },
  { id: "synapse",    name: "Azure Synapse",   color: "#0078D4", logo: "🔹", desc: "Azure analytics" },
  { id: "mysql",      name: "MySQL",           color: "#00758F", logo: "🐬", desc: "Open-source SQL" },
  { id: "oracle",     name: "Oracle",          color: "#F80000", logo: "🅾",  desc: "Enterprise SQL" },
];

function DatabaseConnectModal({
  kindLabel,
  onClose,
  onConnect,
}: {
  kindLabel: string;
  onClose: () => void;
  onConnect: (sourceId: string) => Promise<void>;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [table, setTable] = useState("analytics.marketing_response");
  const [connecting, setConnecting] = useState(false);

  const submit = async () => {
    if (!picked) return;
    setConnecting(true);
    try {
      await onConnect(picked);
      onClose();
    } finally {
      setConnecting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="bg-card border border-border rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Connect a database for {kindLabel}</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Pick a source to ingest your dataset directly. No credentials are stored.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted/40 text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sources grid */}
        <div className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {DB_SOURCES.map((src) => {
              const active = picked === src.id;
              return (
                <button
                  key={src.id}
                  onClick={() => setPicked(src.id)}
                  className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left transition-all ${
                    active
                      ? "border-primary/60 bg-primary/8 ring-1 ring-primary/30"
                      : "border-border bg-muted/[0.04] hover:border-primary/30 hover:bg-muted/10"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none" style={{ filter: active ? "none" : "saturate(0.85)" }}>{src.logo}</span>
                    <span className={`text-xs font-semibold ${active ? "text-primary" : ""}`}>{src.name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{src.desc}</span>
                </button>
              );
            })}
          </div>

          {/* Connection form (mock) */}
          <div className="mt-5 space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Table / Query Path</label>
              <input
                type="text"
                value={table}
                onChange={(e) => setTable(e.target.value)}
                disabled={!picked || connecting}
                className="mt-1 w-full bg-muted/20 border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary/50 disabled:opacity-50"
                placeholder="schema.table_name"
              />
            </div>
            <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/[0.05] border border-border/50 rounded-lg p-2.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>Read-only connection · uses your workspace's stored credentials · query is logged for audit.</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-muted/[0.03]">
          <p className="text-[11px] text-muted-foreground">
            {picked ? <>Source: <span className="text-foreground font-medium">{DB_SOURCES.find((s) => s.id === picked)?.name}</span></> : "Select a source to continue"}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={connecting}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={!picked || connecting} className="gap-1.5 min-w-[110px] justify-center">
              {connecting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting…</> : <><Plug className="h-3.5 w-3.5" />Connect</>}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function FileRow({
  kind,
  meta,
  onUpload,
  onConnectDb,
  selectedTarget,
  selectedOutcome,
  problemType,
  uploadDisabled = false,
}: {
  kind: FileKind;
  meta: FileMeta | undefined;
  onUpload: (kind: string, file: File) => void;
  onConnectDb?: (kind: string) => void;
  selectedTarget?: string;
  selectedOutcome?: string;
  problemType: "classification" | "regression";
  uploadDisabled?: boolean;
}) {
  const loaded = !!meta;
  const isDatasetKind =
    kind.id === "dev_data" || kind.id === "new_data" || kind.id === "hold_data" || kind.id === "new_data_oos";
  const showDataDetails = loaded && isDatasetKind && meta?.rows !== undefined;
  const showModelDetails = loaded && kind.id === "model" && meta?.model_class;
  const targetLabel = problemType === "regression" ? "Target mean" : "Target rate";
  const targetValue =
    meta?.target_rate !== undefined
      ? (problemType === "regression" ? Number(meta.target_rate).toFixed(4) : `${(meta.target_rate * 100).toFixed(1)}%`)
      : "—";

  return (
    <div
      className={`rounded-lg border transition-colors ${
        loaded ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-border bg-muted/[0.04]"
      }`}
    >
      <div className="flex items-center gap-3 p-3">
        <div className={`shrink-0 h-8 w-8 rounded-md flex items-center justify-center ${
          loaded ? "bg-emerald-500/15 text-emerald-300" : "bg-muted/40 text-muted-foreground"
        }`}>
          {loaded ? <CheckCircle className="h-4 w-4" /> : kind.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{kind.label}</p>
            {loaded && <span className="text-[10px] uppercase tracking-wider text-emerald-400/80 font-medium">Ready</span>}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {loaded
              ? `${meta!.filename} · ${meta!.size_kb?.toFixed(1)}KB${meta!.error ? ` ⚠ ${meta!.error}` : ""}`
              : kind.desc}
          </p>
          {loaded && (selectedTarget || selectedOutcome) && (
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              {selectedTarget && (
                <span className="text-[10px] rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary">
                  Target: {selectedTarget}
                  {(kind.id === "new_data" || kind.id === "hold_data" || kind.id === "new_data_oos") ? " (auto)" : ""}
                </span>
              )}
              {selectedOutcome && kind.id === "dev_data" && (
                <span className="text-[10px] rounded border border-border bg-muted/30 px-1.5 py-0.5 text-muted-foreground">
                  Outcome: {selectedOutcome}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onConnectDb && (
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onConnectDb(kind.id)}>
              <Plug className="h-3.5 w-3.5" />Connect DB
            </Button>
          )}
          <label className={uploadDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}>
            <input
              type="file"
              className="hidden"
              accept={kind.ext}
              disabled={uploadDisabled}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && !uploadDisabled) onUpload(kind.id, f);
              }}
            />
            <Button size="sm" variant="ghost" asChild disabled={uploadDisabled}>
              <span className="gap-1.5"><Upload className="h-3.5 w-3.5" />{loaded ? "Replace" : "Upload"}</span>
            </Button>
          </label>
        </div>
      </div>

      {/* Inline schema details for data files */}
      {showDataDetails && (
        <div className="border-t border-border/60 px-3 py-3 space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            <StatPill label="Rows" value={meta!.rows!.toLocaleString()} />
            <StatPill label="Columns" value={String(meta!.cols)} />
            <StatPill
              label={targetLabel}
              value={targetValue}
              tone={meta!.target_present ? "default" : "warn"}
            />
          </div>
          <div className="text-[11px] text-muted-foreground">
            {meta!.numeric_cols ?? 0} numeric · {meta!.cat_cols ?? 0} categorical
            {!meta!.target_present && (
              <span className="text-orange-400 ml-2">⚠ target column missing</span>
            )}
          </div>
          {(kind.id === "new_data" || kind.id === "hold_data" || kind.id === "new_data_oos") && (
            <SchemaCheckBadge check={meta!.schema_check} />
          )}
        </div>
      )}

      {/* Inline details for model file */}
      {showModelDetails && (
        <div className="border-t border-border/60 px-3 py-3">
          <div className="grid grid-cols-3 gap-2">
            <StatPill label="Class" value={String(meta!.model_class)} />
            <StatPill label="Features" value={String(meta!.feature_count ?? "—")} />
            <StatPill label="Estimators" value={meta!.n_estimators ? String(meta!.n_estimators) : "—"} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Ingestion() {
  const [, navigate] = useLocation();
  const { sessionId, setStep, setFilesLoaded, selectedModel } = useSession();
  const problemType: "classification" | "regression" =
    String(selectedModel?.problem_type || "classification").toLowerCase().startsWith("reg")
      ? "regression"
      : "classification";
  const [loadedFiles, setLoadedFiles] = usePersistedState<Record<string, FileMeta>>("rcl:loadedFiles", {});
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [activeAgent, setActiveAgent] = useState<"ingestion" | null>(null);
  const [ingestionDone, setIngestionDone] = useState(false);
  const [ingestionError, setIngestionError] = useState<string | null>(null);
  const [autoProceedAfterIngestion, setAutoProceedAfterIngestion] = useState(false);
  const agentLaunchRef = useRef(false);
  const [, setReproDone] = usePersistedState<boolean>("rcl:reproDone", false);
  const [targetVariable, setTargetVariable] = usePersistedState<string>("rcl:targetVariable", "");
  const [outcomeVariable, setOutcomeVariable] = usePersistedState<string>("rcl:outcomeVariable", "");

  const handleLoadSamples = async () => {
    if (!sessionId) return;
    setSamplesLoading(true);
    try {
      const result = await loadSamples(sessionId, targetVariable || undefined, outcomeVariable || undefined);
      const loaded = (result?.loaded ?? {}) as Record<string, FileMeta>;
      setLoadedFiles(loaded);
      setFilesLoaded(true);
    } finally {
      setSamplesLoading(false);
    }
  };

  const handleClearAllFiles = async () => {
    if (!sessionId) return;
    setClearingAll(true);
    try {
      await Promise.all(
        FILE_KINDS.filter((k) => !!loadedFiles[k.id]).map((k) => removeIngestionFile(sessionId, k.id))
      );
      setLoadedFiles({});
      setFilesLoaded(false);
      setTargetVariable("");
      setOutcomeVariable("");
    } finally {
      setClearingAll(false);
    }
  };

  // Database connection picker for dataset uploads
  const [dbModalKind, setDbModalKind] = useState<string | null>(null);
  const handleConnectDb = async (sourceId: string) => {
    if (!sessionId || !dbModalKind) return;
    // Simulate handshake latency for the demo
    await new Promise((r) => setTimeout(r, 900));
    // Reuse the sample data path so the rest of the workflow is fully functional
    const result = await loadSamples(sessionId, targetVariable || undefined, outcomeVariable || undefined);
    const loaded = (result?.loaded ?? {}) as Record<string, FileMeta>;
    const meta = loaded[dbModalKind];
    if (meta) {
      const branded: FileMeta = {
        ...meta,
        filename: `${sourceId}://analytics.marketing_response`,
      };
      setLoadedFiles((prev) => ({ ...prev, [dbModalKind]: branded }));
    }
  };

  const requiredKinds = FILE_KINDS.filter((k) => !k.optional);
  const loadedCount = requiredKinds.filter((k) => !!loadedFiles[k.id]).length;
  const allFilesLoaded = loadedCount === requiredKinds.length;
  const devDataKind = FILE_KINDS.find((k) => k.id === "dev_data")!;
  const otherDatasetKinds = FILE_KINDS.filter(
    (k) => k.section === "data" && k.id !== "dev_data",
  );
  const modelKinds = FILE_KINDS.filter((k) => k.section === "model");
  const codeKinds = FILE_KINDS.filter((k) => k.section === "code");
  const dictionaryKinds = FILE_KINDS.filter((k) => k.section === "dictionary");
  const devColumns = loadedFiles.dev_data?.columns ?? [];
  const devDataLoaded = !!loadedFiles.dev_data;
  const variablesReady = Boolean(targetVariable && outcomeVariable);

  useEffect(() => {
    if (devColumns.length === 0) return;
    if (targetVariable && !devColumns.includes(targetVariable)) setTargetVariable("");
    if (outcomeVariable && !devColumns.includes(outcomeVariable)) setOutcomeVariable("");
  }, [devColumns, targetVariable, outcomeVariable, setTargetVariable, setOutcomeVariable]);

  useEffect(() => {
    if (!sessionId || !devDataLoaded || !targetVariable || !outcomeVariable) return;
    const timer = window.setTimeout(() => {
      void configureIngestionVariables(sessionId, targetVariable, outcomeVariable).then((res) => {
        if (res.error) return;
        if (res.refreshed) {
          setLoadedFiles((prev) => ({
            ...prev,
            ...(res.refreshed as Record<string, FileMeta>),
          }));
        }
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [sessionId, devDataLoaded, targetVariable, outcomeVariable]);

  // Block forward progress if new_data has a hard schema mismatch with dev_data
  const newDataCheck = loadedFiles.new_data?.schema_check;
  const holdDataCheck = loadedFiles.hold_data?.schema_check;
  const oosDataCheck = loadedFiles.new_data_oos?.schema_check;
  const newSchemaMismatch = !!(newDataCheck && !newDataCheck.match && !newDataCheck.error);
  const holdSchemaMismatch = !!(holdDataCheck && !holdDataCheck.match && !holdDataCheck.error);
  const oosSchemaMismatch = !!(oosDataCheck && !oosDataCheck.match && !oosDataCheck.error);
  const schemaMismatch = newSchemaMismatch || holdSchemaMismatch || oosSchemaMismatch;
  const hasMandatoryVariableSelection = Boolean(targetVariable && outcomeVariable);
  const variableSelectionMissing = !hasMandatoryVariableSelection;

  const handleFileUpload = async (kind: string, file: File) => {
    if (!sessionId) return;
    if (kind !== "dev_data" && !variablesReady) return;
    const targetForUpload = kind === "dev_data" ? undefined : targetVariable || undefined;
    const meta = await uploadFile(sessionId, file, kind, targetForUpload, undefined);
    setLoadedFiles((prev) => ({ ...prev, [kind]: meta }));
    setFilesLoaded(true);
    if (kind === "dev_data") {
      setTargetVariable("");
      setOutcomeVariable("");
    }
  };

  const launchIngestionAgent = () => {
    if (!sessionId || agentLaunchRef.current) return;
    agentLaunchRef.current = true;
    setIngestionError(null);
    void runAgent(sessionId, "ingestion", {
      target_variable: targetVariable,
      outcome_variable: outcomeVariable,
    }).catch((err) => {
      agentLaunchRef.current = false;
      setIngestionError(err instanceof Error ? err.message : "Failed to start ingestion agent");
    });
  };

  const startIngestion = () => {
    if (!sessionId) return;
    if (variableSelectionMissing) return;
    setIngestionDone(false);
    setReproDone(false);
    setIngestionError(null);
    agentLaunchRef.current = false;
    setActiveAgent("ingestion");
    // Kick off immediately; AgentStepper also calls launch on mount as a fallback.
    launchIngestionAgent();
  };

  const handleProceedToDataProcessing = async () => {
    if (schemaMismatch || variableSelectionMissing) return;
    if (ingestionDone) {
      setStep(2);
      navigate("/post-ingestion");
      return;
    }
    setAutoProceedAfterIngestion(true);
    startIngestion();
  };

  return (
    <div className="w-full max-w-none space-y-6">
      <AnimatePresence>
        {dbModalKind && (
          <DatabaseConnectModal
            kindLabel={FILE_KINDS.find((k) => k.id === dbModalKind)?.label || dbModalKind}
            onClose={() => setDbModalKind(null)}
            onConnect={handleConnectDb}
          />
        )}
      </AnimatePresence>

      <div>
        <Button variant="ghost" size="sm" className="text-muted-foreground mb-3 -ml-1" onClick={() => navigate("/")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Inventory
        </Button>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Data &amp; Model Ingestion</h1>
            
          </div>
          {!activeAgent && (
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" onClick={handleLoadSamples} disabled={samplesLoading || clearingAll} variant="outline">
                {samplesLoading ? "Loading…" : (<><Package className="h-3.5 w-3.5 mr-1.5" />Load Sample Data</>)}
              </Button>
              {allFilesLoaded && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={handleClearAllFiles}
                  disabled={clearingAll || samplesLoading}
                  title="Delete all uploaded files"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  {clearingAll ? "Deleting…" : "Delete All"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* File panel */}
      {!activeAgent && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {/* Progress strip */}
          <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground uppercase tracking-wider font-medium">Required Artifacts</span>
                <span className="font-mono text-foreground">
                  <span className="text-emerald-400">{loadedCount}</span> / {requiredKinds.length} required
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <motion.div
                  className="h-full bg-emerald-500"
                  initial={false}
                  animate={{ width: `${(loadedCount / requiredKinds.length) * 100}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
            </div>
          </div>

          <Card className="p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-sm">Development Data</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload Development Data first, then select target and outcome variables from its columns.
              </p>
            </div>
            <FileRow
              kind={devDataKind}
              meta={loadedFiles.dev_data}
              onUpload={handleFileUpload}
              onConnectDb={setDbModalKind}
              selectedTarget={targetVariable}
              selectedOutcome={outcomeVariable}
              problemType={problemType}
            />
            {devDataLoaded && (
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 space-y-3">
                <p className="text-xs font-medium text-primary">Variable selection (required)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Target variable</p>
                    <SearchableVariableSelect
                      value={targetVariable}
                      options={devColumns}
                      placeholder="Select from Development Data columns"
                      onChange={setTargetVariable}
                      allowNone={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Prediction columns</p>
                    <SearchableVariableSelect
                      value={outcomeVariable}
                      options={devColumns}
                      placeholder="Select from Development Data columns"
                      onChange={setOutcomeVariable}
                      allowNone={false}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Both variables are required on Development Data. The outcome column is excluded from schema checks on other datasets.
                  Target is required on New Data, Development Validation Sample, and New Validation Sample.
                </p>
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-sm">Additional Datasets</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {variablesReady
                  ? "Upload remaining datasets — schema-checked against Development Data."
                  : "Complete Development Data upload and variable selection to enable these uploads."}
              </p>
            </div>
            <div className="space-y-2">
              {otherDatasetKinds.map((k) => (
                <FileRow
                  key={k.id}
                  kind={k}
                  meta={loadedFiles[k.id]}
                  onUpload={handleFileUpload}
                  onConnectDb={setDbModalKind}
                  selectedTarget={targetVariable}
                  selectedOutcome={outcomeVariable}
                  problemType={problemType}
                  uploadDisabled={!variablesReady}
                />
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card className="p-5 space-y-3">
              <div>
                <h2 className="font-semibold text-sm">Model Object</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Pickled scikit-learn / xgboost model artifact</p>
              </div>
              <div className="space-y-2">
                {modelKinds.map((k) => (
                  <FileRow
                    key={k.id}
                    kind={k}
                    meta={loadedFiles[k.id]}
                    onUpload={handleFileUpload}
                    problemType={problemType}
                  />
                ))}
              </div>
            </Card>

            <Card className="p-5 space-y-3">
              <div>
                <h2 className="font-semibold text-sm">Code Artifacts</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Preprocessing + feature engineering scripts</p>
              </div>
              <div className="space-y-2">
                {codeKinds.map((k) => (
                  <FileRow
                    key={k.id}
                    kind={k}
                    meta={loadedFiles[k.id]}
                    onUpload={handleFileUpload}
                    problemType={problemType}
                  />
                ))}
              </div>
            </Card>
          </div>

          <Card className="p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-sm">Data Dictionary</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Optional — upload after code artifacts. CSV or Excel with column names, definitions, and types.
              </p>
            </div>
            <div className="space-y-2">
              {dictionaryKinds.map((k) => (
                <FileRow
                  key={k.id}
                  kind={k}
                  meta={loadedFiles[k.id]}
                  onUpload={handleFileUpload}
                  problemType={problemType}
                />
              ))}
            </div>
          </Card>

          {/* Schema mismatch hard block */}
          {schemaMismatch && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-xs text-orange-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                Resolve schema mismatch on
                {newSchemaMismatch && <span className="font-medium"> New Data</span>}
                {newSchemaMismatch && (holdSchemaMismatch || oosSchemaMismatch) && (
                  <span className="font-medium"> and</span>
                )}
                {holdSchemaMismatch && <span className="font-medium"> Development Validation Sample</span>}
                {holdSchemaMismatch && oosSchemaMismatch && <span className="font-medium"> and</span>}
                {oosSchemaMismatch && <span className="font-medium"> New Validation Sample</span>}
                before running ingestion. Re-upload file(s) whose columns and dtypes match Development Data.
              </div>
            </div>
          )}
          {!devDataLoaded && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              Upload Development Data to unlock target and outcome variable selection.
            </div>
          )}
          {devDataLoaded && variableSelectionMissing && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-xs text-orange-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                Select target variable and prediction columns from Development Data before uploading other datasets or proceeding.
              </div>
            </div>
          )}

          {allFilesLoaded && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
              <Button
                onClick={handleProceedToDataProcessing}
                size="lg"
                className="gap-2"
                disabled={!!schemaMismatch || variableSelectionMissing || !devDataLoaded}
              >
                Proceed to Data Processing <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Ingestion agent */}
      <AnimatePresence>
        {activeAgent === "ingestion" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="p-5">
              <h2 className="font-semibold text-sm mb-4">Ingestion Agent</h2>
              {ingestionError && (
                <p className="text-xs text-destructive mb-3">{ingestionError}</p>
              )}
              {sessionId && (
                <AgentStepper
                  sessionId={sessionId}
                  agent="ingestion"
                  onStreamConnected={launchIngestionAgent}
                  onCompleted={() => {
                    agentLaunchRef.current = false;
                    setIngestionDone(true);
                    setActiveAgent(null);
                    if (autoProceedAfterIngestion) {
                      setAutoProceedAfterIngestion(false);
                      setStep(2);
                      navigate("/post-ingestion");
                    }
                  }}
                  onFailed={(message) => {
                    agentLaunchRef.current = false;
                    setIngestionError(message);
                  }}
                />
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Suppress unused-var TS error for ingestionDone (used to gate intermediate state) */}
      <div className="hidden" aria-hidden>{String(ingestionDone)}</div>
    </div>
  );
}
