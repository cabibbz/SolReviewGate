import type { ReviewEvent } from "./types";

export function stateLabel(state: string, kind?: string): string {
  if (kind === "parallel") return state.startsWith("COMPLETE") ? "Answered" : state.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  if (state === "COMPLETE_OPAQUE") return "Not released";
  return state.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function outcomeLabel(code?: string): string {
  const labels: Record<string, string> = {
    RELEASED: "Released",
    MODEL_WITHHELD: "Model withheld",
    GATE_REFUSAL_LANGUAGE: "Blocked: refusal language",
    GATE_SECRET: "Blocked: protected data",
    GATE_INVALID_SCHEMA: "Blocked: invalid format",
    GATE_EMPTY: "Blocked: empty response",
    GATE_OVERSIZE: "Blocked: oversized response",
    WORKER_REJECTED: "Worker rejected",
    START_FAILED: "Start failure",
    POLL_FAILED: "Runtime failure",
    AUTH_UNAVAILABLE: "Authentication unavailable",
    OPERATOR_WITHHELD: "Operator released nothing",
    RELEASED_COMBINED: "Released combined",
    MODEL_UNAVAILABLE: "Model not available to this account",
    SANDBOX_CONFIG_REJECTED: "Sandbox configuration rejected",
    ANSWER_RECORDED: "Answer recorded",
    FILTERED: "Legacy unclassified",
    MOCK: "Mock run",
  };
  return code ? labels[code] || code.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Pending";
}

export function formatBytes(value = 0): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

export function formatDuration(start?: number, end?: number): string {
  if (!start) return "Not started";
  const seconds = Math.max(0, Math.round(((end || Date.now()) - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function sourceLabel(source: ReviewEvent["source"]): string {
  const labels: Record<ReviewEvent["source"], string> = {
    system: "System",
    codex: "Codex",
    usage: "Usage",
    gate: "Release check",
    error: "Error",
    result: "Result",
  };
  return labels[source];
}

export function readableEventTitle(title: string): string {
  if (title === "Opaque result released" || title === "Complete Opaque") return "Review was not released";
  return title;
}

export function readableValue(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try { return readableValue(JSON.parse(text), depth + 1) || text; } catch { return text; }
    }
    return text;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => readableValue(item, depth + 1)).filter(Boolean).join("\n");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "review") {
      const verdict = readableValue(record.verdict, depth + 1);
      const confidence = readableValue(record.confidence, depth + 1);
      const assessment = readableValue(record.assessment, depth + 1);
      const evidence = Array.isArray(record.evidenceCited) ? record.evidenceCited.map((item) => readableValue(item, depth + 1)).filter(Boolean) : [];
      const counterargument = readableValue(record.counterargument, depth + 1);
      const recommendations = Array.isArray(record.recommendations) ? record.recommendations.map((item) => readableValue(item, depth + 1)).filter(Boolean) : [];
      return [verdict ? `Verdict: ${verdict}` : "", confidence ? `Confidence: ${confidence}` : "", assessment, evidence.length ? `Evidence cited:\n${evidence.map((item) => `- ${item}`).join("\n")}` : "", counterargument ? `Counterargument:\n${counterargument}` : "", recommendations.length ? `Recommendations:\n${recommendations.map((item) => `- ${item}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
    }
    if (record.kind === "opaque") return readableValue(record.withheldReason ?? record.assessment, depth + 1) || "Codex returned no substantive review for release.";
    const primary = record.message ?? record.text ?? record.summary ?? record.error ?? record.content;
    const message = readableValue(primary, depth + 1);
    const code = typeof record.code === "string" ? record.code : "";
    if (message) return `${message}${code && !message.includes(code) ? `\nTechnical code: ${code}` : ""}`;
    return Object.entries(record)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => `${key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())}: ${item}`)
      .join("\n");
  }
  return "";
}
