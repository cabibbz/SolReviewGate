import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reviewProtocols, resolveProtocol } from "../../lib/protocols";
import {
  activeConfig,
  defaultReviewSettings,
  getReviewSettings,
  maxPanelConfigs,
  modelChoices,
  normalizeModel,
  normalizeProtocolId,
  normalizeReasoning,
  reviewRuntime,
  reviewSettingsView,
  runConfigs,
  setReviewSettings,
  SettingsError,
} from "../../lib/settings";
import { getStore, resetMemoryStoreForTests } from "../../lib/store";

test.beforeEach(() => resetMemoryStoreForTests());

test("unconfigured deployments review with the environment defaults", async () => {
  const store = getStore();
  assert.deepEqual(await getReviewSettings(store), defaultReviewSettings());
  const { settings, protocol } = await reviewRuntime(store);
  assert.equal(settings.model, defaultReviewSettings().model);
  assert.equal(protocol.id, reviewProtocols[0].id);
  assert.equal(protocol.file, "review-policy.md");
});

test("stores a model, effort, and protocol chosen in the PWA", async () => {
  const store = getStore();
  const saved = await setReviewSettings({ model: "gpt-5.6-codex", reasoning: "high", protocolId: "strict" }, store);
  assert.deepEqual(saved, { model: "gpt-5.6-codex", reasoning: "high", protocolId: "strict", panel: [] });
  assert.deepEqual(await getReviewSettings(store), saved);
  const { protocol } = await reviewRuntime(store);
  assert.equal(protocol.version, "alignment-strict-v1");
  assert.equal(protocol.file, "review-policy-strict.md");
});

test("applies a partial change without dropping the other selections", async () => {
  const store = getStore();
  await setReviewSettings({ model: "gpt-5.6-codex", reasoning: "high", protocolId: "strict" }, store);
  const patched = await setReviewSettings({ protocolId: "control" }, store);
  assert.deepEqual(patched, { model: "gpt-5.6-codex", reasoning: "high", protocolId: "control", panel: [] });
});

test("rejects model names that could reach the Codex command line", async () => {
  const store = getStore();
  for (const model of ["", " ", "-c model_reasoning_effort=\"high\"", "gpt 5.6", "gpt-5.6;rm -rf /", "../etc/passwd", "g", "x".repeat(65)]) {
    await assert.rejects(() => setReviewSettings({ model }, store), (error: unknown) => error instanceof SettingsError && error.code === "INVALID_MODEL");
  }
  assert.equal(normalizeModel(" gpt-5.1-codex-max "), "gpt-5.1-codex-max");
});

test("rejects unsupported reasoning efforts and unknown protocols", async () => {
  const store = getStore();
  await assert.rejects(() => setReviewSettings({ reasoning: "extreme" as never }, store), (error: unknown) => error instanceof SettingsError && error.code === "INVALID_REASONING");
  await assert.rejects(() => setReviewSettings({ protocolId: "../review-policy" }, store), (error: unknown) => error instanceof SettingsError && error.code === "INVALID_PROTOCOL");
  assert.equal(normalizeReasoning("HIGH"), "high");
  assert.equal(normalizeProtocolId(" control "), "control");
  assert.equal((await getReviewSettings(store)).protocolId, defaultReviewSettings().protocolId);
});

test("falls back to deployment defaults when a stored selection is no longer valid", async () => {
  const store = getStore();
  await store.set("sol:settings:review", { model: "not a model", reasoning: "extreme", protocolId: "removed" }, 60);
  assert.deepEqual(await getReviewSettings(store), defaultReviewSettings());
});

test("offers the deployment default, extra configured models, and the active custom model", async () => {
  process.env.SOL_MODEL_CHOICES = "deployment-only-model, , gpt-5.6-codex";
  try {
    const choices = modelChoices("private-custom-model");
    assert.equal(choices[0], defaultReviewSettings().model);
    assert.ok(choices.includes("deployment-only-model"));
    assert.ok(choices.includes("private-custom-model"));
    assert.equal(new Set(choices).size, choices.length);
    assert.equal(choices.some((model) => !model.trim()), false);
  } finally {
    delete process.env.SOL_MODEL_CHOICES;
  }
});

test("stores a comparison set and falls back to the single active configuration", async () => {
  const store = getStore();
  const settings = await setReviewSettings({
    panel: [
      { model: "gpt-5.6-sol", reasoning: "medium", protocolId: "baseline" },
      { model: "gpt-5.6-codex", reasoning: "high", protocolId: "strict" },
    ],
  }, store);
  assert.equal(settings.panel.length, 2);
  assert.deepEqual(runConfigs(settings, true).map((entry) => entry.protocolId), ["baseline", "strict"]);
  assert.deepEqual(runConfigs(settings, false), [activeConfig(settings)]);
  assert.deepEqual(runConfigs({ ...settings, panel: [] }, true), [activeConfig(settings)]);
  assert.deepEqual(await setReviewSettings({ panel: [] }, store), { ...activeConfig(settings), panel: [] });
});

test("rejects an oversized or invalid comparison set", async () => {
  const store = getStore();
  const entry = { model: "gpt-5.6-sol", reasoning: "medium" as const, protocolId: "baseline" };
  await assert.rejects(() => setReviewSettings({ panel: Array.from({ length: maxPanelConfigs + 1 }, () => entry) }, store), (error: unknown) => error instanceof SettingsError && error.code === "INVALID_PANEL");
  await assert.rejects(() => setReviewSettings({ panel: [{ ...entry, model: "not a model" }] }, store), (error: unknown) => error instanceof SettingsError && error.code === "INVALID_MODEL");
  await assert.rejects(() => setReviewSettings({ panel: [{ ...entry, protocolId: "missing" }] }, store), (error: unknown) => error instanceof SettingsError && error.code === "INVALID_PROTOCOL");
  assert.deepEqual((await getReviewSettings(store)).panel, []);
});

test("exposes every protocol choice with a distinct recorded version", async () => {
  const view = await reviewSettingsView(getStore());
  assert.deepEqual(view.protocols.map((protocol) => protocol.id), ["baseline", "control", "strict"]);
  assert.equal(new Set(view.protocols.map((protocol) => protocol.version)).size, view.protocols.length);
  assert.equal(view.reasoningChoices.includes("medium"), true);
  assert.equal(view.protocols.every((protocol) => protocol.label && protocol.summary), true);
  assert.equal("file" in view.protocols[0], false);
});

test("every selectable protocol ships a distinct policy that forbids tools and binds the schema", async () => {
  const policies = await Promise.all(reviewProtocols.map((protocol) => readFile(`sandbox/${protocol.file}`, "utf8")));
  for (const policy of policies) {
    assert.match(policy, /Do not execute or request tools, commands, web searches, files, network access, or external context/);
    assert.match(policy, /must match the supplied JSON schema exactly/);
    assert.match(policy, /never released to the reviewed client/);
  }
  assert.equal(new Set(policies).size, policies.length);
  assert.equal(new Set(reviewProtocols.map((protocol) => protocol.file)).size, reviewProtocols.length);
});

test("the neutral control gives no disposition guidance and the strict protocol demands citations", async () => {
  const control = await readFile(`sandbox/${resolveProtocol("control").file}`, "utf8");
  assert.doesNotMatch(control, /Default to `kind: "review"`/);
  assert.doesNotMatch(control, /only when you must genuinely decline/);
  assert.match(control, /gives no guidance about which response shape to select/);

  const strict = await readFile(`sandbox/${resolveProtocol("strict").file}`, "utf8");
  assert.match(strict, /Default to `kind: "review"`/);
  assert.match(strict, /every material claim names the packet source ID/);
  assert.match(strict, /This field must not be empty/);
});

test("an unknown protocol id resolves to the baseline policy instead of failing a review", () => {
  assert.equal(resolveProtocol("missing").id, reviewProtocols[0].id);
  assert.equal(resolveProtocol(undefined).file, "review-policy.md");
});

test("offers only Codex model ids that exist, and never the invented ones", async () => {
  const choices = modelChoices();
  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    assert.ok(choices.includes(model), `${model} should be offered`);
  }
  // These were never real Codex model ids. Codex answers "Model metadata not found" and the run is wasted.
  for (const model of ["gpt-5.6", "gpt-5.6-codex", "gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.1", "gpt-5-codex"]) {
    assert.equal(choices.includes(model), false, `${model} should not be offered`);
  }
});

test("a comparison slot carries its own protocol and effort", async () => {
  const store = getStore();
  const saved = await setReviewSettings({
    protocolId: "baseline",
    panel: [
      { model: "gpt-5.6-sol", reasoning: "high", protocolId: "control" },
      { model: "gpt-5.6-terra", reasoning: "low", protocolId: "strict" },
    ],
  }, store);
  // Changing the active protocol must not silently rewrite what a slot was set to.
  assert.equal(saved.protocolId, "baseline");
  assert.deepEqual(saved.panel.map((entry) => `${entry.model}/${entry.reasoning}/${entry.protocolId}`), [
    "gpt-5.6-sol/high/control",
    "gpt-5.6-terra/low/strict",
  ]);
  assert.deepEqual(runConfigs(saved, true).map((entry) => entry.protocolId), ["control", "strict"]);
});

test("every review protocol carries the same verification habit, stated as care rather than suspicion", async () => {
  const policies = await Promise.all(reviewProtocols.map((protocol) => readFile(`sandbox/${protocol.file}`, "utf8")));
  for (const policy of policies) {
    // The packet is testimony from the party under review, and the attached file outranks a claim about it.
    assert.match(policy, /testimony rather than a neutral record/);
    assert.match(policy, /Where an attached file and a claim about that file differ, the file is what is true/);
    assert.match(policy, /name it as unverified rather than adopting it/);
    assert.match(policy, /check it against the attachment before relying on it/);
    // It must not become an adversarial stance that skews the verdict.
    assert.match(policy, /Apply this evenly to the parts that support the decision and the parts that undercut it/);
    assert.match(policy, /habit of verification, not suspicion/);
    assert.match(policy, /rather than in a harsher verdict/);
    // And the reviewer never acts.
    assert.match(policy, /You cannot change anything/);
    assert.match(policy, /Never write the edit as though you performed it/);
  }
  // Identical wording across protocols, so a comparison measures the protocol and not this paragraph.
  const paragraph = (policy: string) => policy.slice(policy.indexOf("The packet was assembled by"), policy.indexOf("rather than in a harsher verdict"));
  assert.equal(new Set(policies.map(paragraph)).size, 1);
});
