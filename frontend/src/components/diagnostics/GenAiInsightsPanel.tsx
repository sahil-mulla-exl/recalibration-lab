import { useMemo } from "react";
import { Sparkles } from "lucide-react";

import { Card } from "@/components/ui/card";
import { humanizeDatasetText } from "@/lib/datasetLabels";
import { parseGenAiInsightText, type ParsedGenAiInsight } from "@/lib/genaiInsightParse";

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

export function useParsedGenAiInsight(insight?: GenAiInsightBlock | null): ParsedGenAiInsight | null {
  const text = insight?.text;
  return useMemo(() => {
    const body = resolveInsightBody(insight);
    if (!body || body.status !== "ok" || !body.text) return null;
    return parseGenAiInsightText(body.text);
  }, [insight, text]);
}

/** 2–3 line tab-level summary at the top of each diagnostics / evaluation view. */
export function GenAiTabSummary({
  insight,
  title = "AI summary",
  className = "",
}: {
  insight?: GenAiInsightBlock | null;
  title?: string;
  className?: string;
}) {
  const resolved = resolveInsightBody(insight);
  const parsed = useParsedGenAiInsight(insight);

  if (!resolved) return null;

  if (resolved.status !== "ok") {
    return (
      <Card className={`p-3 border border-violet-200/60 dark:border-violet-800/40 rounded-xl bg-violet-50/50 dark:bg-violet-950/20 ${className}`}>
        <p className="text-xs text-muted-foreground">{resolved.error}</p>
      </Card>
    );
  }

  const summary = parsed?.tabSummary || resolved.text.split("\n").slice(0, 3).join(" ");
  if (!summary.trim()) return null;

  return (
    <Card
      className={`p-3 border border-violet-200/80 dark:border-violet-800/50 bg-gradient-to-r from-violet-50/90 to-transparent dark:from-violet-950/35 dark:to-transparent rounded-xl ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-violet-900 dark:text-violet-200">{title}</p>
          <p className="mt-1 text-xs text-gray-800 dark:text-gray-200 leading-relaxed">{summary}</p>
        </div>
      </div>
    </Card>
  );
}

/** Section-level insight shown directly below a chart block. */
export function GenAiSectionInsight({ text, className = "" }: { text?: string | null; className?: string }) {
  const body = String(text ?? "").trim();
  if (!body) return null;

  return (
    <div
      className={`rounded-lg border border-violet-200/70 dark:border-violet-800/40 bg-violet-50/40 dark:bg-violet-950/15 px-3 py-2.5 ${className}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300 mb-1">
        AI insight
      </p>
      <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
    </div>
  );
}

/** Full LLM block (decision tab / fallback). */
export function GenAiInsightsPanel({
  title = "AI insights",
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
    <Card
      className={`p-4 border border-violet-200/80 dark:border-violet-800/50 bg-gradient-to-r from-violet-50/80 to-transparent dark:from-violet-950/30 dark:to-transparent rounded-xl ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-violet-700 dark:text-violet-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-200">{title}</h3>
          <pre className="mt-2 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
            {body}
          </pre>
        </div>
      </div>
    </Card>
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
