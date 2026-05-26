import type { GovernanceConfig } from "@/types/diagnostics";

const defaultGov: GovernanceConfig = {
  csi: { stable_max: 0.1, medium_max: 0.25 },
  psi_score: { stable_max: 0.1, medium_max: 0.25 },
  iv: { significant_decline: -0.1, weakened_decline: -0.03 },
  missing: { flag_delta_pp: 5, critical_delta_pp: 10 },
};

function merged(gov?: GovernanceConfig): GovernanceConfig {
  return {
    ...defaultGov,
    ...gov,
    csi: { ...defaultGov.csi!, ...(gov?.csi ?? {}) },
    psi_score: { ...defaultGov.psi_score!, ...(gov?.psi_score ?? {}) },
    iv: { ...defaultGov.iv!, ...(gov?.iv ?? {}) },
    missing: { ...defaultGov.missing!, ...(gov?.missing ?? {}) },
  };
}

export function classifyCsi(value: number, gov?: GovernanceConfig): "stable" | "medium" | "large" {
  const cfg = merged(gov).csi!;
  if (value >= cfg.medium_max) return "large";
  if (value >= cfg.stable_max) return "medium";
  return "stable";
}

export function classifyPsi(value: number, gov?: GovernanceConfig): "stable" | "medium" | "large" {
  const cfg = merged(gov).psi_score!;
  if (value >= cfg.medium_max) return "large";
  if (value >= cfg.stable_max) return "medium";
  return "stable";
}

export function classifyIvDelta(value: number, gov?: GovernanceConfig): "significant_decline" | "weakened" | "stable" | "improved" {
  const cfg = merged(gov).iv!;
  if (value <= cfg.significant_decline) return "significant_decline";
  if (value <= cfg.weakened_decline) return "weakened";
  if (value > 0.03) return "improved";
  return "stable";
}
