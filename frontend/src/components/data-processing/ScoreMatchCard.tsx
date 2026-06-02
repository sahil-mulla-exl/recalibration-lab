import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, HelpCircle, Target, XCircle } from "lucide-react";
import { cn } from "@/utils/utils";

type ThresholdKey = "strict" | "relaxed";

export type ScoreMatchTier = {
  label: string;
  card: string;
  value: string;
  ring: string;
  progress: string;
  glow: string;
};

export function scoreMatchTier(pct: number | null): ScoreMatchTier {
  if (pct == null || Number.isNaN(pct)) {
    return {
      label: "Not available",
      card: "border-border bg-muted/15",
      value: "text-muted-foreground",
      ring: "stroke-muted-foreground/30",
      progress: "bg-muted-foreground/40",
      glow: "",
    };
  }
  if (pct >= 99) {
    return {
      label: "Excellent match",
      card: "border-emerald-500/50 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent",
      value: "text-emerald-400",
      ring: "stroke-emerald-400",
      progress: "bg-emerald-400",
      glow: "shadow-[0_0_24px_rgba(52,211,153,0.15)]",
    };
  }
  if (pct >= 95) {
    return {
      label: "Good match",
      card: "border-amber-500/45 bg-gradient-to-br from-amber-500/12 via-amber-500/5 to-transparent",
      value: "text-amber-400",
      ring: "stroke-amber-400",
      progress: "bg-amber-400",
      glow: "shadow-[0_0_20px_rgba(251,191,36,0.12)]",
    };
  }
  if (pct >= 90) {
    return {
      label: "Moderate match",
      card: "border-orange-500/45 bg-gradient-to-br from-orange-500/12 via-orange-500/5 to-transparent",
      value: "text-orange-400",
      ring: "stroke-orange-400",
      progress: "bg-orange-400",
      glow: "shadow-[0_0_20px_rgba(251,146,60,0.12)]",
    };
  }
  return {
    label: "Low match",
    card: "border-red-500/45 bg-gradient-to-br from-red-500/12 via-red-500/5 to-transparent",
    value: "text-red-400",
    ring: "stroke-red-400",
    progress: "bg-red-400",
    glow: "shadow-[0_0_20px_rgba(248,113,113,0.12)]",
  };
}

function TierIcon({ pct }: { pct: number | null }) {
  if (pct == null || Number.isNaN(pct)) return <HelpCircle className="h-5 w-5 text-muted-foreground" />;
  if (pct >= 99) return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  if (pct >= 90) return <AlertTriangle className="h-5 w-5 text-amber-400" />;
  return <XCircle className="h-5 w-5 text-red-400" />;
}

function AnimatedPercent({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let raf = 0;
    const from = shown;
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(from + (value - from) * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate from last rendered value
  }, [value]);

  return <span className={cn("tabular-nums", className)}>{shown.toFixed(1)}</span>;
}

function RingGauge({ pct, tier }: { pct: number; tier: ScoreMatchTier }) {
  const radius = 52;
  const stroke = 9;
  const normalized = Math.min(Math.max(pct, 0), 100);
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (normalized / 100) * circumference;
  const size = (radius + stroke) * 2;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted/30"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={tier.ring}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedPercent value={normalized} className={cn("text-2xl font-bold leading-none", tier.value)} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">match</span>
      </div>
    </div>
  );
}

function ThresholdBar({
  label,
  pct,
  active,
  onSelect,
  tier,
}: {
  label: string;
  pct: number | null;
  active: boolean;
  onSelect: () => void;
  tier: ScoreMatchTier;
}) {
  const value = pct ?? 0;
  const barTier = scoreMatchTier(pct);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg border px-3 py-2.5 transition-all",
        active
          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
          : "border-border/60 bg-muted/10 hover:border-border hover:bg-muted/20",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <span className={cn("text-sm font-mono font-semibold tabular-nums", barTier.value)}>
          {pct != null ? `${pct.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full", active ? tier.progress : barTier.progress)}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, value)}%` }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.15 }}
        />
      </div>
    </button>
  );
}

type ScoreMatchCardProps = {
  rowsCompared: number;
  pctStrict: number | null;
  pctRelaxed: number | null;
};

export function ScoreMatchCard({ rowsCompared, pctStrict, pctRelaxed }: ScoreMatchCardProps) {
  const [activeThreshold, setActiveThreshold] = useState<ThresholdKey>("strict");
  const hasData = rowsCompared > 0 && (pctStrict != null || pctRelaxed != null);
  const activePct = activeThreshold === "strict" ? pctStrict : pctRelaxed;
  const tier = scoreMatchTier(activePct);

  if (!hasData) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/10 p-6 flex items-center gap-3">
        <Target className="h-8 w-8 text-muted-foreground/50 shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">Score Match Rate</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Reference score comparison was not run for this session.
          </p>
        </div>
      </div>
    );
  }

  const displayPct = activePct ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn("rounded-xl border p-4 sm:p-5", tier.card, tier.glow)}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-5">
        <div className="flex items-center gap-4 sm:gap-5 min-w-0 flex-1">
          <RingGauge pct={displayPct} tier={tier} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Score Match Rate
              </p>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  tier.card,
                  tier.value,
                )}
              >
                <TierIcon pct={activePct} />
                {tier.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Platform scores vs reference on{" "}
              <span className="font-mono font-medium text-foreground">{rowsCompared.toLocaleString()}</span>{" "}
              development rows. Select a tolerance band to preview match quality.
            </p>
            <p className="text-[11px] text-muted-foreground/80 mt-2">
              Strict (±0.01) validates production parity; relaxed (±0.05) allows minor scoring drift.
            </p>
          </div>
        </div>

        <div className="w-full lg:w-[min(100%,280px)] shrink-0 space-y-2">
          <ThresholdBar
            label="Within ±0.01 (strict)"
            pct={pctStrict}
            active={activeThreshold === "strict"}
            onSelect={() => setActiveThreshold("strict")}
            tier={tier}
          />
          <ThresholdBar
            label="Within ±0.05 (relaxed)"
            pct={pctRelaxed}
            active={activeThreshold === "relaxed"}
            onSelect={() => setActiveThreshold("relaxed")}
            tier={tier}
          />
        </div>
      </div>
    </motion.div>
  );
}
