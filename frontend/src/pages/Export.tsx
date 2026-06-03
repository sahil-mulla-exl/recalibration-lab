import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Download, ArrowLeft, FileJson, Box, FileText, CheckCircle,
  ShieldAlert, ShieldCheck, AlertTriangle,
} from "lucide-react";
import { exportModel, exportLog, exportReport } from "@/services/api";
import { recalibrationDecisionLabel } from "@/config/diagnostics";
import { SHOW_POLICY_GUARDRAILS } from "@/config/uiVisibility";
import { usePersistedState, useSession, clearAllSessionState } from "@/contexts/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// ── Model passport ──────────────────────────────────────────────────────────
function ModelPassport({
  model,
  drift,
  comparison,
  recalibrationDecision,
}: {
  model: Record<string, string>;
  drift: Record<string, unknown>;
  comparison: Record<string, unknown>;
  recalibrationDecision: string;
}) {
  const aucDelta = ((comparison.new_auc as number) - (comparison.orig_auc as number)) * 100;
  const rows = [
    { label: "Model Name", value: String(model.model_name || "—") },
    { label: "Model ID", value: String(model.model_id || "—"), mono: true },
    { label: "Model Class", value: String(model.model_class || "—") },
    { label: "Drift Verdict", value: recalibrationDecision },
    { label: "Dev AUC", value: Number(drift.orig_auc || 0).toFixed(4), mono: true },
    { label: "New AUC (recalibrated)", value: Number(comparison.new_auc || 0).toFixed(4), mono: true, highlight: true },
    { label: "AUC Improvement", value: `${aucDelta > 0 ? "+" : ""}${aucDelta.toFixed(2)} pp`, mono: true, good: aucDelta > 0 },
    { label: "Calibration Error Δ", value: `${((comparison.new_cal_error as number) - (comparison.orig_cal_error as number)).toFixed(2)}%`, mono: true },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between bg-muted/15 border border-border/50 rounded-lg px-3 py-2">
          <span className="text-xs text-muted-foreground">{r.label}</span>
          <span className={`text-xs font-semibold ${r.mono ? "font-mono" : ""} ${r.highlight ? "text-primary" : r.good === true ? "text-emerald-400" : r.good === false ? "text-orange-400" : ""}`}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Download card ───────────────────────────────────────────────────────────
function DownloadCard({ icon, label, desc, ext, size, url, filename, delay }: {
  icon: ReactNode; label: string; desc: string; ext: string; size: string;
  url: string; filename: string; delay?: number; disabled?: boolean;
}) {
  const handleDownload = () => {
    if (!url || url === "#") return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const extColors: Record<string, string> = {
    ".pkl": "bg-primary/15 text-primary border-primary/30",
    ".json": "bg-blue-500/15 text-blue-400 border-blue-500/30",
    ".pdf": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    ".csv": "bg-orange-500/15 text-orange-400 border-orange-500/30",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay || 0 }}
      className="group"
    >
      <Card className="flex items-center gap-4 p-4 hover:border-primary/30 hover:bg-card/80 transition-all cursor-pointer disabled:cursor-not-allowed opacity-100" onClick={handleDownload}>
        <div className="h-11 w-11 rounded-xl bg-muted/20 border border-border flex items-center justify-center shrink-0 group-hover:border-primary/30 transition-colors">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-semibold text-sm">{label}</p>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${extColors[ext] || "bg-muted/40 text-muted-foreground border-border"}`}>
              {ext}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{desc}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground font-mono">{size}</span>
          <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" asChild>
            <span><Download className="h-3 w-3" />Download</span>
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function ExportPage() {
  const [, navigate] = useLocation();
  const { sessionId, selectedModel, driftResult, evaluationResult, recalibrationResult } = useSession();
  const [selectedAction] = usePersistedState<string>("rcl:selectedRecommendedAction", "recal_opt");

  const model = (selectedModel as Record<string, string>) || {};
  const drift = (driftResult as Record<string, unknown>) || {};
  const evaluation = (evaluationResult as Record<string, unknown>) || {};
  const recalAction =
    String((recalibrationResult as Record<string, unknown> | null)?.selected_action || selectedAction || "");
  const recalibrationDecision = recalibrationDecisionLabel(recalAction);
  const guardrails = (evaluation.policy_guardrails || null) as {
    status?: "pass" | "warn" | "block";
    failed_rules?: Array<{ description: string }>;
    warning_rules?: Array<{ description: string }>;
  } | null;
  const guardrailStatus = guardrails?.status || "pass";

  const downloads = [
    {
      icon: <Box className="h-5 w-5 text-primary" />,
      label: "Recalibrated Model",
      desc: "Serialized scikit-learn / XGBoost object — drop-in replacement for champion",
      ext: ".pkl",
      size: "~2.4 MB",
      url: sessionId ? exportModel(sessionId) : "#",
      filename: "recalibrated_model.pkl",
    },
    {
      icon: <FileJson className="h-5 w-5 text-blue-400" />,
      label: "Recalibration Log",
      desc: "Full audit trail: HP trials, CV folds, train/OOT split, all performance metrics",
      ext: ".json",
      size: "~48 KB",
      url: sessionId ? exportLog(sessionId) : "#",
      filename: "recalibration_log.json",
    },
    {
      icon: <FileText className="h-5 w-5 text-emerald-400" />,
      label: "Summary Report",
      desc: "MRM-ready PDF: drift diagnostics, champion/recalibrated tables, model card",
      ext: ".pdf",
      size: "~1.1 MB",
      url: sessionId ? exportReport(sessionId) : "#",
      filename: "recalibration_report.pdf",
    },
  ];

  return (
    <div className="w-full max-w-none space-y-6 overflow-x-hidden">
      <div>
        <Button variant="ghost" size="sm" className="text-muted-foreground mb-3 -ml-1" onClick={() => navigate("/evaluation")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Evaluation
        </Button>
        <h1 className="text-2xl font-bold">Export</h1>
        </div>

      {SHOW_POLICY_GUARDRAILS && guardrails && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-4">
            <div className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full border ${
              guardrailStatus === "pass"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : guardrailStatus === "warn"
                  ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/30"
            }`}>
              {guardrailStatus === "pass" ? <ShieldCheck className="h-3.5 w-3.5" /> : guardrailStatus === "warn" ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              Guardrails {guardrailStatus}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {guardrailStatus === "pass"
                ? "All policy guardrails passed. This model update is eligible for promotion."
                : guardrailStatus === "warn"
                  ? "Guardrail warnings exist. Promotion requires explicit risk acceptance."
                  : "Promotion is blocked due to critical guardrail violations."}
            </p>
            {guardrailStatus !== "pass" && (
              <ul className="text-xs text-muted-foreground mt-2 space-y-1">
                {[
                  ...(guardrails.failed_rules || []),
                  ...(guardrails.warning_rules || []),
                ].slice(0, 3).map((r, i) => (
                  <li key={i}>- {r.description}</li>
                ))}
              </ul>
            )}
          </Card>
        </motion.div>
      )}

      {/* Model passport */}
      {!!drift.orig_auc && !!evaluation.new_auc && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-5">
            <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-3">Model Card</h3>
            <ModelPassport
              model={model}
              drift={drift}
              comparison={evaluation}
              recalibrationDecision={recalibrationDecision}
            />
          </Card>
        </motion.div>
      )}

      {/* Downloads */}
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Download Artifacts</p>
        <div className="space-y-2">
          {downloads.map((dl, i) => (
            <DownloadCard key={dl.label} {...dl} delay={0.25 + i * 0.08} />
          ))}
        </div>
      </div>

      {/* New run */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
        <div className="rounded-xl border border-border p-4 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Ready to recalibrate another model?</p>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              clearAllSessionState();
              window.location.href = import.meta.env.BASE_URL || "/";
            }}
          >
            <CheckCircle className="h-3.5 w-3.5" />Start a New Recalibration Run
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
