import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyWorkerFailure, normalizeCodexEvents, sandboxStatus } from "../../lib/sandbox-runtime";
import { getStore, resetMemoryStoreForTests } from "../../lib/store";

test.beforeEach(() => resetMemoryStoreForTests());

// The variants Codex accepts for web_search. Anything else is a hard config load failure.
const codexWebSearchVariants = ["disabled", "cached", "indexed", "live"];

test("expired Codex snapshots require reconnection before review", async () => {
  const store = getStore();
  await store.set("sol:sandbox:base", {
    snapshotId: "expired",
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    codexVersion: "test",
  }, 60);
  assert.equal((await sandboxStatus(store)).configured, false);
});

test("normalizes observable Codex messages, usage, and object errors", () => {
  const events = normalizeCodexEvents([
    JSON.stringify({ type: "thread.started", thread_id: "thread-1", sol_observed_at: 100 }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Review complete" }, sol_observed_at: 101 }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 8, reasoning_output_tokens: 3 }, sol_observed_at: 102 }),
    JSON.stringify({ type: "error", error: { code: "invalid_json_schema", message: "Schema rejected" }, sol_observed_at: 103 }),
    "not-json",
  ].join("\n"), 1);

  assert.equal(events.length, 4);
  assert.equal(events[1].message, "Review complete");
  assert.equal(events[2].usage?.reasoningOutputTokens, 3);
  assert.match(events[3].message || "", /invalid_json_schema/);
  assert.deepEqual(events.map((event) => event.at), [100, 101, 102, 103]);
});

test("turns structured Codex responses into readable live text", () => {
  const events = normalizeCodexEvents(JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: JSON.stringify({ kind: "review", verdict: "NEEDS_IMPROVEMENT", assessment: "The decision needs one correction.", recommendations: ["Verify the source."] }),
    },
    sol_observed_at: 200,
  }));
  assert.equal(events[0].title, "Codex completed its response");
  assert.equal(events[0].message, "Verdict: NEEDS_IMPROVEMENT\n\nThe decision needs one correction.\n\nRecommendations:\n- Verify the source.");
  assert.doesNotMatch(events[0].message || "", /[{}\[\]"]/);
});

test("preserves all emitted text while removing event envelope metadata", () => {
  const events = normalizeCodexEvents([
    JSON.stringify({ type: "item.completed", item: { type: "reasoning", summary: [{ type: "summary_text", text: "First exact reasoning summary." }, { type: "summary_text", text: "Second exact reasoning summary." }] } }),
    JSON.stringify({ type: "agent_message", text: "Exact top-level answer text." }),
  ].join("\n"), 500);
  assert.equal(events[0].message, "First exact reasoning summary.\nSecond exact reasoning summary.");
  assert.equal(events[1].message, "Exact top-level answer text.");
  assert.doesNotMatch(events.map((event) => event.message).join("\n"), /summary_text|item\.completed|[{}]/);
});

test("retains the phone-only explanation from a withheld response", () => {
  const events = normalizeCodexEvents(JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: JSON.stringify({ kind: "opaque", verdict: "OPAQUE", assessment: "A material portion had to be declined.", recommendations: [] }),
    },
  }));
  assert.equal(events[0].message, "A material portion had to be declined.");
});

test("the worker only ever asks Codex for a documented web_search variant", async () => {
  // "enabled" is not a variant. --strict-config turned it into an immediate config load failure,
  // so every researched run died in about a second without reaching the model.
  const worker = await readFile(new URL("../../sandbox/worker.mjs", import.meta.url), "utf8");
  const assignments = [...worker.matchAll(/web_search="?\$\{[^}]*\}"?|web_search="([a-z]+)"/g)];
  assert.ok(assignments.length > 0, "the worker no longer sets web_search");

  const values = [...worker.matchAll(/research \? "([a-z]+)" : "([a-z]+)"/g)].flatMap((match) => [match[1], match[2]]);
  assert.deepEqual(values, ["live", "disabled"]);
  for (const value of values) {
    assert.ok(codexWebSearchVariants.includes(value), `web_search="${value}" is not a Codex variant`);
  }

  const runtimeConfig = await readFile(new URL("../../sandbox/config.toml", import.meta.url), "utf8");
  const declared = /web_search\s*=\s*"([a-z]+)"/.exec(runtimeConfig);
  assert.ok(declared && codexWebSearchVariants.includes(declared[1]), "config.toml declares an unknown web_search variant");
  assert.equal(declared?.[1], "disabled", "the resting configuration must not reach the web");
});

test("a rejected sandbox configuration is not reported as a model or gate outcome", () => {
  const codeFor = classifyWorkerFailure;

  assert.equal(codeFor('Error loading config.toml: unknown variant `enabled`, expected one of `disabled`, `cached`, `indexed`, `live` in `web_search`'), "SANDBOX_CONFIG_REJECTED");
  assert.equal(codeFor("unknown field `web_serch`"), "SANDBOX_CONFIG_REJECTED");
  assert.equal(codeFor("invalid type: string, expected a boolean"), "SANDBOX_CONFIG_REJECTED");
  assert.equal(codeFor("Model metadata for `gpt-5.6-nope` not found"), "MODEL_UNAVAILABLE");
  assert.equal(codeFor("the run attempted a tool"), "WORKER_REJECTED");
});
