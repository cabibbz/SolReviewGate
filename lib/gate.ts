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
  const counterargument = review.counterargument ? `\nCOUNTERARGUMENT:\n${review.counterargument}` : "\nCOUNTERARGUMENT:\nNone identified.";
  const recommendations = review.recommendations.length
    ? `\nRECOMMENDATIONS:\n${review.recommendations.map((item) => `- ${item}`).join("\n")}`
    : "\nRECOMMENDATIONS:\n- None";
  return `VERDICT: ${review.verdict}\nCONFIDENCE: ${review.confidence}\nASSESSMENT:\n${review.assessment}${evidence}${counterargument}${recommendations}`;
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
