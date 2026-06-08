import { useMemo, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { Card } from "@/components/ui/card";
import { humanizeDatasetText } from "@/lib/datasetLabels";
import {
  extractInsightBullets,
  parseGenAiInsightText,
  type ParsedGenAiInsight,
} from "@/lib/genaiInsightParse";

export type GenAiInsightBlock = {
  prompt_id?: string;
  status?: string;
  text?: string;
  error?: string;
};

function resolveInsightBody(insight?: GenAiInsightBlock | null): {
  status: string;
  text: string;
  error?: string;
} | null {
  if (!insight) return null;
  const status = String(insight.status ?? "").toLowerCase();
  const text = String(insight.text ?? "").trim();
  if (status === "disabled") return null;
  if (status === "ok" && text) return { status, text };
  if (status === "skipped" || status === "error") {
    return {
      status,
      text: "",
      error: humanizeDatasetText(
        insight.error?.trim() ||
          "AI insights are not available. Re-run this agent after AI is configured in the backend.",
      ),
    };
  }
  return null;
}

function formatInsightParagraphs(text: string, max = 4): string[] {
  const bullets = extractInsightBullets(text, max);
  if (bullets.length) return bullets;

  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length > 1) return blocks.slice(0, max);

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?]+[.!?]+/g) ?? [normalized];
  return sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, max);
}

function AiGeminiIcon({ size = "md" }: { size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div
      className={`${dim} shrink-0 rounded-full bg-gradient-to-br from-[#4285f4] via-[#9b72cb] to-[#d96570] p-[1.5px] shadow-sm`}
    >
      <div className="flex h-full w-full items-center justify-center rounded-full bg-white dark:bg-slate-950">
        <Sparkles className={`${icon} text-[#9b72cb] dark:text-[#c4a8e8]`} />
      </div>
    </div>
  );
}

function AiShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(60,64,67,0.08),0_4px_16px_rgba(60,64,67,0.06)] dark:border-slate-700/70 dark:bg-[#1a1d23] dark:shadow-[0_2px_12px_rgba(0,0,0,0.35)] ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4285f4]/40 to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#4285f4]/[0.04] via-[#9b72cb]/[0.05] to-[#d96570]/[0.03] dark:from-[#4285f4]/[0.08] dark:via-[#9b72cb]/[0.06] dark:to-[#d96570]/[0.04]"
        aria-hidden
      />
      <div className="relative">{children}</div>
    </div>
  );
}

function AiBulletList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((item, idx) => (
        <li key={idx} className="flex gap-2.5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
          <span
            className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-[#4285f4] to-[#9b72cb]"
            aria-hidden
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function AiInsightBody({ text }: { text: string }) {
  const bullets = formatInsightParagraphs(text, 4);
  if (bullets.length) return <AiBulletList items={bullets} />;
  return (
    <p className="mt-2 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
      {text}
    </p>
  );
}

export function useParsedGenAiInsight(insight?: GenAiInsightBlock | null): ParsedGenAiInsight | null {
  const text = insight?.text;
  return useMemo(() => {
    const body = resolveInsightBody(insight);
    if (!body || body.status !== "ok" || !body.text) return null;
    return parseGenAiInsightText(body.text);
  }, [insight, text]);
}

/** Tab-level AI overview — Gemini-style recommendation card. */
export function GenAiTabSummary({
  insight,
  title = "AI summary",
  bullets: bulletsOverride,
  className = "",
}: {
  insight?: GenAiInsightBlock | null;
  title?: string;
  bullets?: string[];
  className?: string;
}) {
  const resolved = resolveInsightBody(insight);
  const parsed = useParsedGenAiInsight(insight);

  if (!resolved) return null;

  if (resolved.status !== "ok") {
    const errorText = /^slice\(none,/i.test(String(resolved.error ?? ""))
      ? "AI evaluation insights could not be generated. Re-run the evaluation agent after restarting the backend."
      : resolved.error;
    return (
      <AiShell className={className}>
        <div className="flex items-start gap-3 p-4">
          <AiGeminiIcon size="sm" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{errorText}</p>
        </div>
      </AiShell>
    );
  }

  const bullets =
    bulletsOverride?.length
      ? bulletsOverride
      : parsed?.tabSummaryBullets?.length
        ? parsed.tabSummaryBullets
        : formatInsightParagraphs(parsed?.rawText || parsed?.tabSummary || resolved.text, 4);
  if (!bullets.length) {
    const fallback = resolved.text.replace(/\s+/g, " ").trim();
    if (!fallback) return null;
    return (
      <AiShell className={className}>
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <AiGeminiIcon />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                AI
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">{fallback}</p>
          </div>
        </div>
      </AiShell>
    );
  }

  return (
    <AiShell className={className}>
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <AiGeminiIcon />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                AI
              </span>
            </div>
            <AiBulletList items={bullets} />
          </div>
        </div>
      </div>
    </AiShell>
  );
}

/** Section-level insight nested under chart blocks. */
export function GenAiSectionInsight({
  text,
  label = "AI insight",
  className = "",
}: {
  text?: string | null;
  label?: string;
  className?: string;
}) {
  const body = String(text ?? "").trim();
  if (!body) return null;

  const bullets = formatInsightParagraphs(body, 4);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/80 dark:border-slate-700/60 dark:bg-slate-900/50 ${className}`}
    >
      <div
        className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#4285f4] via-[#9b72cb] to-[#d96570]"
        aria-hidden
      />
      <div className="py-3 pl-4 pr-4 sm:pl-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="h-3.5 w-3.5 text-[#9b72cb]" />
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</p>
        </div>
        {bullets.length ? (
          <ul className="space-y-2.5">
            {bullets.map((item, idx) => (
              <li key={idx} className="flex gap-2.5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-[#4285f4] to-[#9b72cb]"
                  aria-hidden
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{body}</p>
        )}
      </div>
    </div>
  );
}

/** Full AI recommendation block (decision tab). */
export function GenAiInsightsPanel({
  title = "AI recommendation",
  insight,
  className = "",
}: {
  title?: string;
  insight?: GenAiInsightBlock | null;
  className?: string;
}) {
  const resolved = resolveInsightBody(insight);
  if (!resolved) return null;

  const body =
    resolved.status === "ok"
      ? resolved.text
      : resolved.error ||
        "AI insights are not available. Re-run this agent after AI is configured in the backend.";

  return (
    <AiShell className={className}>
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <AiGeminiIcon />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</h3>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                AI
              </span>
            </div>
            {resolved.status === "ok" ? (
              <AiInsightBody text={body} />
            ) : (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{body}</p>
            )}
          </div>
        </div>
      </div>
    </AiShell>
  );
}

export function pickGenAiInsight(
  report: Record<string, unknown> | undefined,
  key: string,
): GenAiInsightBlock | null {
  if (!report) return null;
  const insights = report.genai_insights as Record<string, GenAiInsightBlock> | undefined;
  if (!insights || typeof insights !== "object") return null;
  const block = insights[key];
  return block && typeof block === "object" ? block : null;
}
