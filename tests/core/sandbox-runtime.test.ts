import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCodexEvents, sandboxStatus } from "../../lib/sandbox-runtime";
import { getStore, resetMemoryStoreForTests } from "../../lib/store";

test.beforeEach(() => resetMemoryStoreForTests());

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
