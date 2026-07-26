import { config } from "@/lib/config";
import { defaultProtocolId, findProtocol, resolveProtocol, reviewProtocols, type ReviewProtocol } from "@/lib/protocols";
import { getStore, type Store } from "@/lib/store";

const settingsKey = "sol:settings:review";
const settingsTtlSeconds = 10 * 365 * 24 * 60 * 60;

export const reasoningEfforts = ["minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

/** Codex receives the model as one argv value and the effort inside a `-c` assignment. Both are constrained here. */
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;

/**
 * Model ids the Codex CLI accepts for `--model`. The GPT-5.6 family is Sol, Terra, and Luna;
 * there is no bare `gpt-5.6` and no `gpt-5.6-codex`. Availability still depends on the account
 * and the installed CLI version, so this is a starting list and any other id can be entered.
 */
const builtInModels = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
] as const;

export interface ReviewConfig {
  model: string;
  reasoning: ReasoningEffort;
  protocolId: string;
}

export interface ReviewSettings extends ReviewConfig {
  /** Extra configurations run as comparison candidates for one packet. Empty means a single run. */
  panel: ReviewConfig[];
}

export const maxPanelConfigs = 6;

export interface ReviewSettingsView {
  settings: ReviewSettings;
  defaults: ReviewSettings;
  modelChoices: string[];
  reasoningChoices: readonly ReasoningEffort[];
  protocols: { id: string; version: string; label: string; summary: string }[];
  maxPanelConfigs: number;
}

export type SettingsErrorCode = "INVALID_MODEL" | "INVALID_REASONING" | "INVALID_PROTOCOL" | "INVALID_PANEL";

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

export function normalizeConfig(value: unknown): ReviewConfig {
  const record = (value && typeof value === "object" ? value : {}) as Partial<ReviewConfig>;
  return {
    model: normalizeModel(record.model),
    reasoning: normalizeReasoning(record.reasoning),
    protocolId: normalizeProtocolId(record.protocolId),
  };
}

export function normalizePanel(value: unknown): ReviewConfig[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxPanelConfigs) throw new SettingsError("INVALID_PANEL");
  return value.map((entry) => normalizeConfig(entry));
}

/** Deployment defaults from the environment. Invalid environment values fall back instead of failing a review. */
export function defaultReviewSettings(): ReviewSettings {
  return {
    model: safe(() => normalizeModel(config.model), builtInModels[0]),
    reasoning: safe(() => normalizeReasoning(config.reasoning), "medium"),
    protocolId: defaultProtocolId,
    panel: [],
  };
}

export function modelChoices(current: string | string[] = []): string[] {
  const configured = (process.env.SOL_MODEL_CHOICES || "").split(",").map((value) => value.trim()).filter(Boolean);
  const active = Array.isArray(current) ? current : [current];
  const candidates = [defaultReviewSettings().model, ...configured, ...builtInModels, ...active];
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
    panel: safe(() => normalizePanel(stored.panel), defaults.panel),
  };
}

export async function setReviewSettings(patch: Partial<ReviewSettings>, store: Store = getStore()): Promise<ReviewSettings> {
  const current = await getReviewSettings(store);
  const next: ReviewSettings = {
    model: patch.model === undefined ? current.model : normalizeModel(patch.model),
    reasoning: patch.reasoning === undefined ? current.reasoning : normalizeReasoning(patch.reasoning),
    protocolId: patch.protocolId === undefined ? current.protocolId : normalizeProtocolId(patch.protocolId),
    panel: patch.panel === undefined ? current.panel : normalizePanel(patch.panel),
  };
  await store.set(settingsKey, next, settingsTtlSeconds);
  return next;
}

export function activeConfig(settings: ReviewSettings): ReviewConfig {
  return { model: settings.model, reasoning: settings.reasoning, protocolId: settings.protocolId };
}

/**
 * The configurations one approval runs. `panel` requests the comparison set, and an empty
 * comparison set always falls back to the single active configuration.
 */
export function runConfigs(settings: ReviewSettings, panel: boolean): ReviewConfig[] {
  return panel && settings.panel.length ? settings.panel : [activeConfig(settings)];
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
    modelChoices: modelChoices([settings.model, ...settings.panel.map((entry) => entry.model)]),
    reasoningChoices: reasoningEfforts,
    protocols: reviewProtocols.map(({ id, version, label, summary }) => ({ id, version, label, summary })),
    maxPanelConfigs,
  };
}
