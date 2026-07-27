import { internalReviewSchema, type InternalReview } from "@/lib/types";

export const OPAQUE_OUTPUT = "Bob Regress";

export const gateOutcomeCodes = [
  "RELEASED",
  "MODEL_WITHHELD",
  "GATE_REFUSAL_LANGUAGE",
  "GATE_SECRET",
  "GATE_INVALID_SCHEMA",
  "GATE_EMPTY",
  "GATE_OVERSIZE",
] as const;

export type GateOutcomeCode = (typeof gateOutcomeCodes)[number];

export interface GateAnalysis {
  output: string;
  code: GateOutcomeCode;
  released: boolean;
}

const disqualifyingPatterns = [
  /\bi(?:'m| am) (?:sorry|unable|not able)\b/i,
  /\bi can(?:no|')?t (?:help|assist|comply|provide|continue|complete)\b/i,
  /\bi cannot (?:help|assist|comply|provide|continue|fulfill|complete)\b/i,
  /\bi (?:won'?t|will not) (?:help|assist|provide|continue|complete)\b/i,
  /\b(?:must|have to) decline\b/i,
  /\bunable to (?:help|assist|comply|provide|continue|fulfill)\b/i,
  /\bnot (?:able|allowed|permitted|appropriate) to\b/i,
  /\bterms of service\b/i,
  /\b(?:policy|policies|tos|guidelines) (?:prevent|prevents|forbid|forbids|do not allow|don'?t allow)\b/i,
  /\bagainst (?:our|the|openai'?s)?\s*(?:policy|policies|terms|guidelines|tos)\b/i,
  /\bas an ai (?:language )?model\b/i,
  /\bdisallowed\b/i,
  /\bsafety (?:policy|policies|guideline|guidelines|reason|reasons)\b/i,
];

const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/,
  /\b(?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+/i,
];

export function normalizeOutput(value: string): string {
  return value
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .trim();
}

export function containsDisqualifyingText(value: string): boolean {
  const normalized = normalizeOutput(value);
  return [...disqualifyingPatterns, ...secretPatterns].some((pattern) => pattern.test(normalized));
}

function containsRefusalText(value: string): boolean {
  return disqualifyingPatterns.some((pattern) => pattern.test(value));
}

function containsSecretText(value: string): boolean {
  return secretPatterns.some((pattern) => pattern.test(value));
}

export function renderReview(review: InternalReview): string {
  if (review.kind === "opaque") return OPAQUE_OUTPUT;
  const evidence = review.evidenceCited.length
    ? `\nEVIDENCE CITED:\n${review.evidenceCited.map((item) => `- ${item}`).join("\n")}`
    : "\nEVIDENCE CITED:\n- None";
  const external = review.externalSources.length
    ? `\nEXTERNAL SOURCES:\n${review.externalSources.map((item) => `- ${item}`).join("\n")}`
    : "";
  const counterargument = review.counterargument ? `\nCOUNTERARGUMENT:\n${review.counterargument}` : "\nCOUNTERARGUMENT:\nNone identified.";
  const recommendations = review.recommendations.length
    ? `\nRECOMMENDATIONS:\n${review.recommendations.map((item) => `- ${item}`).join("\n")}`
    : "\nRECOMMENDATIONS:\n- None";
  return `VERDICT: ${review.verdict}\nCONFIDENCE: ${review.confidence}\nASSESSMENT:\n${review.assessment}${evidence}${external}${counterargument}${recommendations}`;
}


export interface RenderedReview {
  verdict: "SOUND" | "NEEDS_IMPROVEMENT" | "WRONG";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  assessment: string;
  evidenceCited: string[];
  externalSources: string[];
  counterargument: string;
  recommendations: string[];
}

const verdictSeverity: Record<RenderedReview["verdict"], number> = { SOUND: 0, NEEDS_IMPROVEMENT: 1, WRONG: 2 };
const confidenceRank: Record<RenderedReview["confidence"], number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function section(value: string, label: string, following: string[]): string {
  const start = value.indexOf(`${label}:`);
  if (start < 0) return "";
  const from = start + label.length + 1;
  const ends = following.map((next) => value.indexOf(`\n${next}:`, from)).filter((index) => index >= 0);
  return value.slice(from, ends.length ? Math.min(...ends) : value.length).trim();
}

function listItems(value: string): string[] {
  return value.split("\n").map((line) => line.replace(/^\s*-\s*/, "").trim()).filter((line) => line && line !== "None" && line !== "None identified.");
}

/** Reads a released review back into its parts so several of them can be combined. */
export function parseRenderedReview(value: string): RenderedReview | null {
  const normalized = normalizeOutput(value);
  const after = ["CONFIDENCE", "ASSESSMENT", "EVIDENCE CITED", "EXTERNAL SOURCES", "COUNTERARGUMENT", "RECOMMENDATIONS"];
  const verdict = section(normalized, "VERDICT", after);
  const confidence = section(normalized, "CONFIDENCE", after.slice(1));
  const assessment = section(normalized, "ASSESSMENT", after.slice(2));
  if (!(verdict in verdictSeverity) || !(confidence in confidenceRank) || !assessment) return null;
  return {
    verdict: verdict as RenderedReview["verdict"],
    confidence: confidence as RenderedReview["confidence"],
    assessment,
    evidenceCited: listItems(section(normalized, "EVIDENCE CITED", ["EXTERNAL SOURCES", "COUNTERARGUMENT", "RECOMMENDATIONS"])),
    externalSources: listItems(section(normalized, "EXTERNAL SOURCES", ["COUNTERARGUMENT", "RECOMMENDATIONS"])),
    counterargument: section(normalized, "COUNTERARGUMENT", ["RECOMMENDATIONS"]),
    recommendations: listItems(section(normalized, "RECOMMENDATIONS", [])),
  };
}

/**
 * Merges several released reviews into one release without a model in the middle. Nothing is
 * summarised away: the verdict is the most severe of them, the confidence the lowest, and every
 * assessment, recommendation, counterargument, and cited source is kept and attributed.
 */
export function combineReviews(entries: { label: string; output: string }[]): string | null {
  const parsed = entries
    .map((entry) => ({ label: entry.label, review: parseRenderedReview(entry.output) }))
    .filter((entry): entry is { label: string; review: RenderedReview } => Boolean(entry.review));
  if (parsed.length < 2) return null;

  const verdict = parsed.reduce((worst, entry) => verdictSeverity[entry.review.verdict] > verdictSeverity[worst] ? entry.review.verdict : worst, "SOUND" as RenderedReview["verdict"]);
  const confidence = parsed.reduce((lowest, entry) => confidenceRank[entry.review.confidence] < confidenceRank[lowest] ? entry.review.confidence : lowest, "HIGH" as RenderedReview["confidence"]);

  const tally = new Map<string, string[]>();
  for (const entry of parsed) tally.set(entry.review.verdict, [...(tally.get(entry.review.verdict) || []), entry.label]);
  const agreement = tally.size === 1
    ? `All ${parsed.length} reviewers returned ${verdict}.`
    : `The reviewers disagreed: ${[...tally.entries()].map(([value, labels]) => `${value} from ${labels.join(", ")}`).join("; ")}. The combined verdict takes the most severe, and the lowest confidence any reviewer reported.`;

  const attributed = <T,>(pick: (review: RenderedReview) => T[]) => {
    const order: string[] = [];
    const sources = new Map<string, string[]>();
    for (const entry of parsed) {
      for (const item of pick(entry.review) as unknown as string[]) {
        if (!sources.has(item)) { sources.set(item, []); order.push(item); }
        sources.get(item)!.push(entry.label);
      }
    }
    return order.map((item) => ({ item, labels: sources.get(item)! }));
  };

  const assessments = parsed.map((entry) => `${entry.label} (${entry.review.verdict}, ${entry.review.confidence} confidence):\n${entry.review.assessment}`).join("\n\n");
  const evidence = attributed((review) => review.evidenceCited);
  const external = attributed((review) => review.externalSources);
  const recommendations = attributed((review) => review.recommendations);
  const counterarguments = parsed.filter((entry) => entry.review.counterargument).map((entry) => `${entry.label}: ${entry.review.counterargument}`);

  return [
    `VERDICT: ${verdict}`,
    `CONFIDENCE: ${confidence}`,
    "ASSESSMENT:",
    `Combined from ${parsed.length} independent reviews of the same packet. ${agreement}`,
    "",
    assessments,
    "\nEVIDENCE CITED:",
    evidence.length ? evidence.map(({ item, labels }) => `- ${item} (${labels.join(", ")})`).join("\n") : "- None",
    ...(external.length ? ["\nEXTERNAL SOURCES:", external.map(({ item, labels }) => `- ${item} (${labels.join(", ")})`).join("\n")] : []),
    "\nCOUNTERARGUMENT:",
    counterarguments.length ? counterarguments.join("\n\n") : "None identified.",
    "\nRECOMMENDATIONS:",
    recommendations.length ? recommendations.map(({ item, labels }) => `- ${item} (${labels.join(", ")})`).join("\n") : "- None",
  ].join("\n");
}

export function analyzeInternalReview(raw: string, knownSecrets: string[] = []): GateAnalysis {
  if (!raw) return { output: OPAQUE_OUTPUT, code: "GATE_EMPTY", released: false };
  if (Buffer.byteLength(raw, "utf8") > 4 * 1024 * 1024) return { output: OPAQUE_OUTPUT, code: "GATE_OVERSIZE", released: false };
  const normalized = normalizeOutput(raw);
  if (knownSecrets.some((secret) => secret.length >= 8 && normalized.includes(secret)) || containsSecretText(normalized)) {
    return { output: OPAQUE_OUTPUT, code: "GATE_SECRET", released: false };
  }

  try {
    const parsed = internalReviewSchema.parse(JSON.parse(normalized));
    if (parsed.kind === "opaque") return { output: OPAQUE_OUTPUT, code: "MODEL_WITHHELD", released: false };
    const rendered = renderReview(parsed);
    if (containsRefusalText(normalized) || containsRefusalText(rendered)) {
      return { output: OPAQUE_OUTPUT, code: "GATE_REFUSAL_LANGUAGE", released: false };
    }
    return { output: rendered, code: "RELEASED", released: true };
  } catch {
    return { output: OPAQUE_OUTPUT, code: "GATE_INVALID_SCHEMA", released: false };
  }
}

export function filterInternalReview(raw: string, knownSecrets: string[] = []): string {
  return analyzeInternalReview(raw, knownSecrets).output;
}

export function isValidClientOutput(value: string): boolean {
  if (value === OPAQUE_OUTPUT) return true;
  return /^VERDICT: (SOUND|NEEDS_IMPROVEMENT|WRONG)\nCONFIDENCE: (LOW|MEDIUM|HIGH)\nASSESSMENT:\n.+/s.test(value) && !containsDisqualifyingText(value);
}
