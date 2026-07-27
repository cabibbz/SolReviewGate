import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyWorkerFailure, normalizeCodexEvents, observedSearchesForTests, sandboxStatus } from "../../lib/sandbox-runtime";
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

  // The mode alone is not enough. features.web_search_request decides whether the tool is offered
  // at all, and setting only the mode is indistinguishable from a model that declined to search:
  // a clean review, zero search events, and no error anywhere.
  assert.match(worker, /features\.web_search_request=true/, "a research run never enables the search tool");
  const featureLine = /\.\.\.\(research \? \["-c", "features\.web_search_request=true"\] : \[\]\)/.exec(worker);
  assert.ok(featureLine, "the search tool must be enabled for research runs only");

  const runtimeConfig = await readFile(new URL("../../sandbox/config.toml", import.meta.url), "utf8");
  const declared = /web_search\s*=\s*"([a-z]+)"/.exec(runtimeConfig);
  assert.ok(declared && codexWebSearchVariants.includes(declared[1]), "config.toml declares an unknown web_search variant");
  assert.equal(declared?.[1], "disabled", "the resting configuration must not reach the web");
  assert.doesNotMatch(runtimeConfig, /web_search_request/, "the resting configuration must not offer the search tool");
});

test("the worker denies by default, so an unnamed tool type ends the run", () => {
  // The guard used to list the item types to kill on, which let anything unlisted through --
  // apply_patch, list_dir, and every tool type added after it was written. Now the benign set is
  // the enumerated one. Mirrors sandbox/worker.mjs exactly.
  const verdict = (eventType: string, itemType: string, research: boolean) => {
    const benignItem = /^(agent_message|reasoning|agent_reasoning(_delta)?|todo_list|plan|error)$/i.test(itemType);
    const searching = research && /^(web_search|web_search_request|web_fetch|browser_search)$/i.test(itemType);
    const structural = !itemType && /^(thread\.started|turn\.started|turn\.completed|turn\.failed|error)$/i.test(eventType);
    return (!benignItem && !searching && !structural) ? "kill" : searching ? "record" : "pass";
  };

  // An ordinary review runs to completion.
  for (const event of ["thread.started", "turn.started", "turn.completed", "turn.failed"]) {
    assert.equal(verdict(event, "", false), "pass", `${event} ended a normal review`);
  }
  assert.equal(verdict("item.completed", "agent_message", false), "pass");
  assert.equal(verdict("item.completed", "reasoning", false), "pass");

  // A live search issues queries and reads the pages they return; both are the same channel.
  assert.equal(verdict("item.completed", "web_search", true), "record");
  assert.equal(verdict("item.completed", "web_search_request", true), "record");
  assert.equal(verdict("item.completed", "web_fetch", true), "record");

  // Packet-only runs kill on exactly those events.
  assert.equal(verdict("item.completed", "web_search", false), "kill");
  assert.equal(verdict("item.completed", "web_fetch", false), "kill");

  // Research widens nothing beyond the web, including things the old deny list missed entirely.
  for (const item of ["command_execution", "unified_exec", "apply_patch", "file_change", "mcp_tool_call", "list_dir", "view_image", "tool_search", "a_tool_added_next_year"]) {
    assert.equal(verdict("item.completed", item, true), "kill", `${item} survived a researched run`);
  }
});

test("a rejected sandbox configuration is not reported as a model or gate outcome", () => {
  const codeFor = classifyWorkerFailure;

  assert.equal(codeFor('Error loading config.toml: unknown variant `enabled`, expected one of `disabled`, `cached`, `indexed`, `live` in `web_search`'), "SANDBOX_CONFIG_REJECTED");
  assert.equal(codeFor("unknown field `web_serch`"), "SANDBOX_CONFIG_REJECTED");
  assert.equal(codeFor("invalid type: string, expected a boolean"), "SANDBOX_CONFIG_REJECTED");
  assert.equal(codeFor("Model metadata for `gpt-5.6-nope` not found"), "MODEL_UNAVAILABLE");
  assert.equal(codeFor("the run attempted a tool"), "WORKER_REJECTED");
});

test("a research run always reports its searches, and a packet-only run reports nothing", () => {
  const envelope: { research?: boolean; searchLog?: string[] } = {};

  // Packet-only: undefined, so "no search ran" and "research was off" stay distinguishable.
  assert.equal(observedSearchesForTests({ ...envelope }), undefined);
  assert.equal(observedSearchesForTests({ ...envelope, research: false, searchLog: ["ignored"] }), undefined);

  // Research on, nothing searched: an empty list, not a missing one.
  assert.deepEqual(observedSearchesForTests({ ...envelope, research: true }), []);
  assert.deepEqual(observedSearchesForTests({ ...envelope, research: true, searchLog: [] }), []);

  assert.deepEqual(observedSearchesForTests({ ...envelope, research: true, searchLog: ["codex web_search variants", "next.js 15 app router"] }), [
    "codex web_search variants",
    "next.js 15 app router",
  ]);

  const many = observedSearchesForTests({ ...envelope, research: true, searchLog: Array.from({ length: 80 }, (_, index) => `query ${index}`) });
  assert.equal(many?.length, 50);
  assert.equal(observedSearchesForTests({ ...envelope, research: true, searchLog: ["x".repeat(500)] })?.[0].length, 200);
});
