import {
  CONCEPT_GENAI_SECTIONS,
  DATA_GENAI_SECTIONS,
  EVALUATION_GENAI_SECTIONS,
  PERFORMANCE_GENAI_SECTIONS,
  RECALIBRATION_GENAI_SECTIONS,
} from "@/config/genaiSections";

export type ParsedGenAiSection = { title: string; body: string };

export type ParsedGenAiInsight = {
  sections: ParsedGenAiSection[];
  tabSummary: string;
  tabSummaryBullets: string[];
  rawText: string;
};

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^=+|=+$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleMatches(title: string, aliases: readonly string[]): boolean {
  const norm = normalizeTitle(title);
  return aliases.some((alias) => norm.includes(alias) || alias.includes(norm));
}

function isEqualsDelimiterLine(line: string): boolean {
  return /^={4,}\s*$/.test(line.trim());
}

function isSkippableTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return (
    lower.startsWith("you are") ||
    lower.includes("required response structure") ||
    lower.includes("response format") ||
    lower.includes("tone:") ||
    /^use only the json/i.test(title) ||
    lower.startsWith("output format") ||
    lower.startsWith("section title")
  );
}

const PROMPT_ECHO_PATTERNS = [
  /^you are a senior statistical modeler/i,
  /^tone:/i,
  /^use only the json calculation payload/i,
  /^required response structure/i,
  /^response format \(mandatory\)/i,
  /^below is the json output from the recalibration lab/i,
  /^format each section with a banner line/i,
  /^do not echo system instructions/i,
  /^maximum \d+ words/i,
  /^output format:/i,
  /^section title \(exact name from blocks above\)$/i,
  /^your insights for that section only\.?$/i,
];

function stripPromptEcho(text: string): string {
  const kept: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      kept.push("");
      continue;
    }
    if (isEqualsDelimiterLine(line)) {
      kept.push(raw);
      continue;
    }
    if (PROMPT_ECHO_PATTERNS.some((re) => re.test(line))) continue;
    if (/^={3,}\s*$/.test(line)) continue;
    kept.push(raw);
  }
  return kept.join("\n").trim();
}

export function extractInsightBullets(body: string, max = 4): string[] {
  const bullets: string[] = [];
  for (const raw of body.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    if (/^\d+\.\s+[A-Z][A-Z\s/&-]+$/.test(line)) continue;
    if (/^headline read$/i.test(line)) continue;
    const bulletMatch = line.match(/^[-*•]\s+(.+)/);
    if (bulletMatch) line = bulletMatch[1].trim();
    else line = line.replace(/^\d+\.\s+/, "").trim();
    if (line.length < 8) continue;
    if (/^slice\(none,\s*\d+,\s*none\)$/i.test(line)) continue;
    if (!bullets.includes(line)) bullets.push(line);
    if (bullets.length >= max) break;
  }
  return bullets;
}

/** Prompt-native format: === title === with body until the next === block. */
function parseEqualsBlockSections(text: string): ParsedGenAiSection[] {
  const lines = text.split("\n");
  const sections: ParsedGenAiSection[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isEqualsDelimiterLine(lines[i])) {
      i++;
      continue;
    }
    i++;

    const titleParts: string[] = [];
    while (i < lines.length && lines[i].trim() && !isEqualsDelimiterLine(lines[i])) {
      titleParts.push(lines[i].trim());
      i++;
    }
    if (i < lines.length && isEqualsDelimiterLine(lines[i])) i++;

    const title = titleParts.join(" ").trim();
    const bodyLines: string[] = [];
    while (i < lines.length && !isEqualsDelimiterLine(lines[i])) {
      bodyLines.push(lines[i]);
      i++;
    }

    const body = bodyLines.join("\n").trim();
    if (title && !isSkippableTitle(title) && (body || title)) {
      sections.push({ title, body });
    }
  }

  return sections;
}

function parseLegacyEqualsSplit(text: string): ParsedGenAiSection[] {
  const pieces = text
    .split(/\n={4,}\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const sections: ParsedGenAiSection[] = [];
  for (const piece of pieces) {
    const lines = piece.split("\n");
    const title = lines[0]?.replace(/^=+\s*|\s*=+$/g, "").trim() ?? "";
    const body = lines.slice(1).join("\n").trim();
    if (!title || isSkippableTitle(title)) continue;
    sections.push({ title, body: body || piece });
  }
  return sections;
}

function parseMarkdownHeaderSections(text: string): ParsedGenAiSection[] {
  const matches = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)];
  if (matches.length < 2) return [];

  const sections: ParsedGenAiSection[] = [];
  for (let m = 0; m < matches.length; m++) {
    const title = matches[m][1].trim();
    if (!title || isSkippableTitle(title)) continue;
    const start = (matches[m].index ?? 0) + matches[m][0].length;
    const end = m + 1 < matches.length ? (matches[m + 1].index ?? text.length) : text.length;
    const body = text.slice(start, end).trim();
    sections.push({ title, body });
  }
  return sections;
}

/** Split LLM markdown on === section banners, markdown headers, or legacy delimiters. */
export function parseGenAiSections(text: string): ParsedGenAiSection[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const equalsSections = parseEqualsBlockSections(normalized);
  if (equalsSections.length >= 2) return equalsSections;

  const legacySections = parseLegacyEqualsSplit(normalized);
  if (legacySections.length >= 2) return legacySections;

  const markdownSections = parseMarkdownHeaderSections(normalized);
  if (markdownSections.length >= 2) return markdownSections;

  if (equalsSections.length === 1) return equalsSections;
  if (legacySections.length === 1) return legacySections;
  if (markdownSections.length === 1) return markdownSections;

  if (normalized.length > 0) {
    return [{ title: "Insights", body: normalized }];
  }
  return [];
}

/** Informative bullets across all sections for tab-level AI summary. */
export function buildTabSummaryBullets(sections: ParsedGenAiSection[], maxBullets = 4): string[] {
  const picked: string[] = [];
  for (const section of sections) {
    for (const line of extractInsightBullets(section.body, maxBullets)) {
      if (picked.length >= maxBullets) break;
      if (!picked.includes(line)) picked.push(line);
    }
    if (picked.length >= maxBullets) break;
  }
  if (picked.length) return picked;

  const flat = sections.map((s) => s.body).join("\n").trim();
  if (!flat) return [];
  const fromFlat = extractInsightBullets(flat, maxBullets);
  if (fromFlat.length) return fromFlat;

  const sentences = flat.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [flat];
  return sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, maxBullets);
}

export function buildTabSummary(sections: ParsedGenAiSection[], maxLines = 4): string {
  return buildTabSummaryBullets(sections, maxLines).join(" ");
}

function formatSectionBody(body: string, maxBullets = 4): string {
  const bullets = extractInsightBullets(body, maxBullets);
  if (bullets.length) return bullets.map((b) => `- ${b}`).join("\n");
  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    if (/^\d+\.\s+[A-Z][A-Z\s/&-]+$/.test(line)) continue;
    line = line.replace(/^[-*•]\s+/, "");
    if (/^[*]\s*(delta|stable|moderate|major|recovered|lift)/i.test(line) && line.length < 50) continue;
    lines.push(line);
  }
  const joined = lines.join("\n").trim();
  return joined || body.trim();
}

function aliasHeaderPatterns(aliases: readonly string[]): RegExp[] {
  return aliases.map((alias) => {
    const pattern = alias
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "[\\s\\-/]+");
    return new RegExp(`^(?:={0,}\\s*)?(?:#{1,3}\\s+)?${pattern}[^\\n]*$`, "im");
  });
}

function nextSectionStart(text: string): number {
  const patterns = [
    /\n={4,}\s*\n/,
    /\n#{1,3}\s+[A-Z]/,
    /\n[A-Z][A-Z0-9 ,()\-/&]{10,}\s*\n/,
  ];
  let best = -1;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m.index >= 0 && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/** When structured parsing fails, locate a section by header keywords in the raw text. */
function extractFlatSection(rawText: string, aliases: readonly string[]): string | null {
  let bestIndex = -1;
  let bestLength = 0;

  for (const re of aliasHeaderPatterns(aliases)) {
    const m = rawText.match(re);
    if (m && m.index !== undefined && (bestIndex === -1 || m.index < bestIndex)) {
      bestIndex = m.index;
      bestLength = m[0].length;
    }
  }

  if (bestIndex >= 0) {
    const rest = rawText.slice(bestIndex + bestLength);
    const end = nextSectionStart(rest);
    const chunk = (end === -1 ? rest : rest.slice(0, end)).trim();
    const formatted = formatSectionBody(chunk);
    if (formatted) return formatted;
  }

  const normAliases = aliases.map((a) => a.toLowerCase());
  const paragraphs = rawText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const hits = paragraphs.filter((p) => {
    const lower = p.toLowerCase();
    return normAliases.some((a) => lower.includes(a));
  });
  if (hits.length) return formatSectionBody(hits.join("\n\n"));
  return null;
}

export function parseGenAiInsightText(text: string): ParsedGenAiInsight {
  const cleaned = stripPromptEcho(text.replace(/\r\n/g, "\n").trim());
  const sections = parseGenAiSections(cleaned);
  const tabSummaryBullets = buildTabSummaryBullets(sections, 4);
  return {
    sections,
    tabSummary: tabSummaryBullets.join(" "),
    tabSummaryBullets,
    rawText: cleaned,
  };
}

export function pickSectionText(
  parsed: ParsedGenAiInsight | null,
  aliases: readonly string[],
): string | null {
  if (!parsed) return null;

  const bodies = parsed.sections
    .filter((s) => titleMatches(s.title, aliases))
    .map((s) => formatSectionBody(s.body))
    .filter(Boolean);

  if (bodies.length) return bodies.join("\n\n");

  return extractFlatSection(parsed.rawText, aliases);
}

export function pickPerformanceSection(
  parsed: ParsedGenAiInsight | null,
  sectionId: keyof typeof PERFORMANCE_GENAI_SECTIONS,
): string | null {
  return pickSectionText(parsed, PERFORMANCE_GENAI_SECTIONS[sectionId]);
}

export function pickDataSection(
  parsed: ParsedGenAiInsight | null,
  sectionId: keyof typeof DATA_GENAI_SECTIONS,
): string | null {
  return pickSectionText(parsed, DATA_GENAI_SECTIONS[sectionId]);
}

export function pickConceptSection(
  parsed: ParsedGenAiInsight | null,
  sectionId: keyof typeof CONCEPT_GENAI_SECTIONS,
): string | null {
  return pickSectionText(parsed, CONCEPT_GENAI_SECTIONS[sectionId]);
}

export function pickEvaluationSection(
  parsed: ParsedGenAiInsight | null,
  sectionId: keyof typeof EVALUATION_GENAI_SECTIONS,
): string | null {
  return pickSectionText(parsed, EVALUATION_GENAI_SECTIONS[sectionId]);
}

/** Concise evaluation tab summary: headline metrics + deployment verdict. */
export function buildEvaluationCombinedBullets(
  parsed: ParsedGenAiInsight | null,
  maxBullets = 4,
): string[] {
  if (!parsed) return [];
  const metrics = pickEvaluationSection(parsed, "metrics");
  const recommended = pickEvaluationSection(parsed, "recommended");
  const merged = [
    ...extractInsightBullets(metrics ?? "", 2),
    ...extractInsightBullets(recommended ?? "", 2),
  ].filter((bullet, index, arr) => arr.indexOf(bullet) === index);
  if (merged.length) return merged.slice(0, maxBullets);
  return parsed.tabSummaryBullets.slice(0, maxBullets);
}

export function pickRecalibrationSection(
  parsed: ParsedGenAiInsight | null,
  sectionId: keyof typeof RECALIBRATION_GENAI_SECTIONS,
): string | null {
  return pickSectionText(parsed, RECALIBRATION_GENAI_SECTIONS[sectionId]);
}

