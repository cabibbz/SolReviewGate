import { config } from "@/lib/config";
import { defaultProtocolId, findProtocol, resolveProtocol, reviewProtocols, type ReviewProtocol } from "@/lib/protocols";
import { getStore, type Store } from "@/lib/store";

const settingsKey = "sol:settings:review";
const settingsTtlSeconds = 10 * 365 * 24 * 60 * 60;

export const reasoningEfforts = ["minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

/** Codex receives the model as one argv value and the effort inside a `-c` assignment. Both are constrained here. */
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;

const builtInModels = [
  "gpt-5.6-sol",
  "gpt-5.6-codex",
  "gpt-5.6",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex",
  "gpt-5.1",
  "gpt-5-codex",
] as const;

export interface ReviewSettings {
  model: string;
  reasoning: ReasoningEffort;
  protocolId: string;
}

export interface ReviewSettingsView {
  settings: ReviewSettings;
  defaults: ReviewSettings;
  modelChoices: string[];
  reasoningChoices: readonly ReasoningEffort[];
  protocols: { id: string; version: string; label: string; summary: string }[];
}

export type SettingsErrorCode = "INVALID_MODEL" | "INVALID_REASONING" | "INVALID_PROTOCOL";

export class SettingsError extends Error {
  constructor(public readonly code: SettingsErrorCode) {
    super(code);
  }
}

export function normalizeModel(value: unknown): string {
  const model = typeof value === "string" ? value.trim() : "";
  if (!modelPattern.test(model)) throw new SettingsError("INVALID_MODEL");
  return model;
}

export function normalizeReasoning(value: unknown): ReasoningEffort {
  const reasoning = typeof value === "string" ? value.trim().toLowerCase() : "";
  const match = reasoningEfforts.find((effort) => effort === reasoning);
  if (!match) throw new SettingsError("INVALID_REASONING");
  return match;
}

export function normalizeProtocolId(value: unknown): string {
  const protocol = findProtocol(typeof value === "string" ? value.trim() : "");
  if (!protocol) throw new SettingsError("INVALID_PROTOCOL");
  return protocol.id;
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** Deployment defaults from the environment. Invalid environment values fall back instead of failing a review. */
export function defaultReviewSettings(): ReviewSettings {
  return {
    model: safe(() => normalizeModel(config.model), builtInModels[0]),
    reasoning: safe(() => normalizeReasoning(config.reasoning), "medium"),
    protocolId: defaultProtocolId,
  };
}

export function modelChoices(current?: string): string[] {
  const configured = (process.env.SOL_MODEL_CHOICES || "").split(",").map((value) => value.trim()).filter(Boolean);
  const candidates = [defaultReviewSettings().model, ...configured, ...builtInModels, current || ""];
  const valid = candidates.filter((value) => safe(() => Boolean(normalizeModel(value)), false));
  return [...new Set(valid)];
}

export async function getReviewSettings(store: Store = getStore()): Promise<ReviewSettings> {
  const defaults = defaultReviewSettings();
  const stored = await store.get<Partial<ReviewSettings>>(settingsKey);
  if (!stored) return defaults;
  return {
    model: safe(() => normalizeModel(stored.model), defaults.model),
    reasoning: safe(() => normalizeReasoning(stored.reasoning), defaults.reasoning),
    protocolId: safe(() => normalizeProtocolId(stored.protocolId), defaults.protocolId),
  };
}

export async function setReviewSettings(patch: Partial<ReviewSettings>, store: Store = getStore()): Promise<ReviewSettings> {
  const current = await getReviewSettings(store);
  const next: ReviewSettings = {
    model: patch.model === undefined ? current.model : normalizeModel(patch.model),
    reasoning: patch.reasoning === undefined ? current.reasoning : normalizeReasoning(patch.reasoning),
    protocolId: patch.protocolId === undefined ? current.protocolId : normalizeProtocolId(patch.protocolId),
  };
  await store.set(settingsKey, next, settingsTtlSeconds);
  return next;
}

/** Settings plus the resolved protocol used by a single review run. */
export async function reviewRuntime(store: Store = getStore()): Promise<{ settings: ReviewSettings; protocol: ReviewProtocol }> {
  const settings = await getReviewSettings(store);
  return { settings, protocol: resolveProtocol(settings.protocolId) };
}

export async function reviewSettingsView(store: Store = getStore()): Promise<ReviewSettingsView> {
  const settings = await getReviewSettings(store);
  return {
    settings,
    defaults: defaultReviewSettings(),
    modelChoices: modelChoices(settings.model),
    reasoningChoices: reasoningEfforts,
    protocols: reviewProtocols.map(({ id, version, label, summary }) => ({ id, version, label, summary })),
  };
}
