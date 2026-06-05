import {
  CONCEPT_GENAI_SECTIONS,
  DATA_GENAI_SECTIONS,
  EVALUATION_GENAI_SECTIONS,
  PERFORMANCE_GENAI_SECTIONS,
} from "@/config/genaiSections";

export type ParsedGenAiSection = { title: string; body: string };

export type ParsedGenAiInsight = {
  sections: ParsedGenAiSection[];
  tabSummary: string;
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
  return lower.startsWith("you are") || /^use only the json/i.test(title);
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

function insightLines(body: string): string[] {
  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "");
    if (line.startsWith("*") || line.length < 24) continue;
    if (/^headline read$/i.test(line)) continue;
    lines.push(line);
  }
  return lines;
}

/** First 2–3 substantive lines across parsed sections for tab header. */
export function buildTabSummary(sections: ParsedGenAiSection[], maxLines = 3): string {
  const picked: string[] = [];
  for (const section of sections) {
    for (const line of insightLines(section.body)) {
      if (picked.length >= maxLines) break;
      if (!picked.includes(line)) picked.push(line);
    }
    if (picked.length >= maxLines) break;
  }
  if (picked.length === 0) {
    const flat = sections.map((s) => s.body).join(" ").replace(/\s+/g, " ").trim();
    if (!flat) return "";
    const sentences = flat.match(/[^.!?]+[.!?]+/g) ?? [flat];
    return sentences.slice(0, maxLines).join(" ").trim();
  }
  return picked.slice(0, maxLines).join(" ");
}

function formatSectionBody(body: string): string {
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
  const sections = parseGenAiSections(text);
  return { sections, tabSummary: buildTabSummary(sections), rawText: text };
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
