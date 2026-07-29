import type { Candidate } from "./types";
import { readableValue } from "./format";

export interface ReadableResult {
  verdict: string;
  assessment: string;
  recommendations: string[];
  released: boolean;
  confidence?: string;
  evidence?: string[];
  externalSources?: string[];
  filesReferenced?: string[];
  counterargument?: string;
}

function resultSection(value: string, label: string, following: string[]): string {
  const start = value.indexOf(`${label}:`);
  if (start < 0) return "";
  const contentStart = start + label.length + 1;
  const ends = following.map((next) => value.indexOf(`\n${next}:`, contentStart)).filter((index) => index >= 0);
  return value.slice(contentStart, ends.length ? Math.min(...ends) : value.length).trim();
}

export function parseResult(value: string | null): ReadableResult | null {
  if (!value) return null;
  if (value.trim() === "Bob Regress") return { verdict: "Not released", assessment: "No substantive review was released.", recommendations: [], released: false };
  const verdict = resultSection(value, "VERDICT", ["CONFIDENCE", "ASSESSMENT", "EVIDENCE CITED", "EXTERNAL SOURCES", "ATTACHED FILES USED", "COUNTERARGUMENT", "RECOMMENDATIONS"]);
  const assessment = resultSection(value, "ASSESSMENT", ["EVIDENCE CITED", "EXTERNAL SOURCES", "ATTACHED FILES USED", "COUNTERARGUMENT", "RECOMMENDATIONS"]);
  if (!verdict || !assessment) return { verdict: "Review", assessment: readableValue(value), recommendations: [], released: true };
  const evidence = resultSection(value, "EVIDENCE CITED", ["EXTERNAL SOURCES", "ATTACHED FILES USED", "COUNTERARGUMENT", "RECOMMENDATIONS"]);
  const external = resultSection(value, "EXTERNAL SOURCES", ["ATTACHED FILES USED", "COUNTERARGUMENT", "RECOMMENDATIONS"]);
  const filesRead = resultSection(value, "ATTACHED FILES USED", ["COUNTERARGUMENT", "RECOMMENDATIONS"]);
  const recommendations = resultSection(value, "RECOMMENDATIONS", []);
  const bullets = (text: string) => text.split("\n").map((item) => item.replace(/^\s*-\s*/, "").trim()).filter((item) => item && item !== "None");
  return {
    verdict: verdict.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    confidence: resultSection(value, "CONFIDENCE", ["ASSESSMENT", "EVIDENCE CITED", "COUNTERARGUMENT", "RECOMMENDATIONS"]),
    assessment,
    evidence: bullets(evidence),
    externalSources: bullets(external),
    filesReferenced: bullets(filesRead),
    counterargument: resultSection(value, "COUNTERARGUMENT", ["RECOMMENDATIONS"]),
    recommendations: bullets(recommendations),
    released: true,
  };
}

export function parseCodexResponse(value: string | null): ReadableResult | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.kind === "review") {
      const verdict = typeof parsed.verdict === "string" ? parsed.verdict : "Codex response";
      return {
        verdict: verdict.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        confidence: readableValue(parsed.confidence),
        assessment: readableValue(parsed.assessment) || "Codex returned a review without an assessment.",
        evidence: Array.isArray(parsed.evidenceCited) ? parsed.evidenceCited.map((item) => readableValue(item)).filter(Boolean) : [],
        externalSources: Array.isArray(parsed.externalSources) ? parsed.externalSources.map((item) => readableValue(item)).filter(Boolean) : [],
        filesReferenced: Array.isArray(parsed.filesReferenced) ? parsed.filesReferenced.map((item) => readableValue(item)).filter(Boolean) : [],
        counterargument: readableValue(parsed.counterargument),
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map((item) => readableValue(item)).filter(Boolean) : [],
        released: false,
      };
    }
    if (parsed.kind === "opaque") return { verdict: "No review", assessment: readableValue(parsed.withheldReason ?? parsed.assessment) || "Codex returned no substantive review.", recommendations: [], released: false };
  } catch {
    // Provider diagnostics and malformed candidates are still useful as plain text.
  }
  return { verdict: "Codex response", assessment: readableValue(value), recommendations: [], released: false };
}

export interface ParallelAnswer {
  answer: string;
  approach: string;
  confidence: string;
  assumptions: string[];
  evidence: string[];
  openQuestions: string[];
}

export function parseParallelAnswer(value: string | null): ParallelAnswer | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.answer !== "string" || !parsed.answer.trim()) return null;
    const list = (item: unknown) => Array.isArray(item) ? item.map((entry) => readableValue(entry)).filter(Boolean) : [];
    return {
      answer: parsed.answer,
      approach: readableValue(parsed.approach),
      confidence: readableValue(parsed.confidence),
      assumptions: list(parsed.assumptions),
      evidence: list(parsed.evidenceCited),
      openQuestions: list(parsed.openQuestions),
    };
  } catch {
    return null;
  }
}

export interface ComparisonRow {
  id: string;
  /** Distinguishes this candidate from the others by whatever actually differs between them. */
  label: string;
  model: string;
  protocolVersion: string;
  reasoning: string;
  verdict: string;
  confidence: string;
  releasable: boolean;
  evidence: string[];
}

export const shortProtocol = (version: string) => version.replace(/^alignment-/, "");

/** Reads the candidate responses into one comparison, so disagreement is visible before reading. */
export function comparison(rows: Candidate[]): { rows: ComparisonRow[]; agreement: string; evidence: { source: string; models: string[] }[] } | null {
  const complete = rows.filter((candidate) => !candidate.postRelease && candidate.state === "COMPLETE");
  // The same model can appear under two protocols, and the same pair under two efforts.
  const sharedModel = (candidate: Candidate) => complete.filter((other) => other.model === candidate.model).length > 1;
  const sharedProtocol = (candidate: Candidate) => complete.filter((other) => other.model === candidate.model && other.protocolVersion === candidate.protocolVersion).length > 1;
  const parsed = complete.map((candidate) => {
    const result = parseResult(candidate.result || null);
    return {
      id: candidate.id,
      label: sharedModel(candidate)
        ? `${candidate.model} · ${shortProtocol(candidate.protocolVersion)}${sharedProtocol(candidate) ? ` · ${candidate.reasoning}` : ""}`
        : candidate.model,
      model: candidate.model,
      protocolVersion: candidate.protocolVersion,
      reasoning: candidate.reasoning,
      verdict: candidate.releasable && result ? result.verdict : "No answer",
      confidence: result?.confidence || "",
      releasable: Boolean(candidate.releasable),
      evidence: result?.evidence || [],
    };
  });
  if (parsed.length < 2) return null;
  const verdicts = parsed.filter((row) => row.releasable).map((row) => row.verdict);
  const counts = new Map<string, number>();
  for (const verdict of verdicts) counts.set(verdict, (counts.get(verdict) || 0) + 1);
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const agreement = !ranked.length
    ? "No candidate produced a releasable answer."
    : ranked.length === 1
      ? `All ${ranked[0][1]} usable answers agree: ${ranked[0][0]}.`
      : `${ranked.map(([verdict, count]) => `${count} say ${verdict}`).join(", ")}. They disagree.`;
  const sources = [...new Set(parsed.flatMap((row) => row.evidence))].sort();
  const evidence = sources.map((source) => ({
    source,
    models: parsed.filter((row) => row.evidence.includes(source)).map((row) => row.label),
  }));
  return { rows: parsed, agreement, evidence };
}

/**
 * What approving will authorize beyond the packet. Research is the one egress channel in the
 * system, so the moment of consent has to say when it is on. Null when every run is packet-only.
 */
export function approvalResearchNotice(settings?: { research?: boolean; panel: { research?: boolean }[] } | null, panel = false): string | null {
  if (!settings) return null;
  if (panel && settings.panel.length) {
    const researching = settings.panel.filter((slot) => slot.research).length;
    if (!researching) return null;
    return researching === settings.panel.length
      ? `All ${researching} candidates run with web research`
      : `${researching} of ${settings.panel.length} candidates run with web research`;
  }
  return settings.research ? "This review runs with web research" : null;
}
