import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { researchStatus } from "../../lib/research";

test("a packet-only run and a research run that searched nothing are not the same thing", () => {
  assert.equal(researchStatus({ research: false }).level, "off");
  assert.equal(researchStatus(null).level, "off");
  assert.equal(researchStatus(undefined).level, "off");

  const none = researchStatus({ research: true, searchCount: 0 });
  assert.equal(none.level, "none");
  assert.match(none.detail, /chose not to search/);

  // A run finished before counting existed reports nothing rather than a misleading zero.
  assert.equal(researchStatus({ research: true }).level, "unrecorded");
});

test("observed searches are reported with the queries that left the sandbox", () => {
  const status = researchStatus({ research: true, searchCount: 2, searchLog: ["codex web_search variants", "vercel sandbox egress"] });
  assert.equal(status.level, "ran");
  assert.equal(status.label, "2 searches");
  assert.deepEqual(status.queries, ["codex web_search variants", "vercel sandbox egress"]);

  assert.equal(researchStatus({ research: true, searchCount: 1, searchLog: ["one"] }).label, "1 search");
});

test("sources cited without a search behind them are called out, not counted", () => {
  // The case the operator cannot otherwise detect: the review names external sources, and the
  // transport stream shows nothing ever left the sandbox.
  const fabricated = researchStatus({ research: true, searchCount: 0 }, 3);
  assert.equal(fabricated.level, "mismatch");
  assert.match(fabricated.detail, /No search left the sandbox/);
  assert.match(fabricated.detail, /3 external sources/);

  // Same claim, but research was never enabled for the run at all.
  const offEntirely = researchStatus({ research: false }, 1);
  assert.equal(offEntirely.level, "mismatch");
  assert.match(offEntirely.detail, /1 external source\b/);

  // Searching and citing is the consistent case.
  assert.equal(researchStatus({ research: true, searchCount: 2, searchLog: ["a", "b"] }, 2).level, "ran");
  // Searching and citing nothing is fine, and says so.
  assert.match(researchStatus({ research: true, searchCount: 2, searchLog: ["a", "b"] }, 0).detail, /names no external source/);
});

test("a zero-search research run shows what Codex said instead of blaming the reviewer", () => {
  const plain = researchStatus({ research: true, searchCount: 0 });
  assert.equal(plain.level, "none");
  assert.equal(plain.note, "");
  assert.match(plain.detail, /chose not to search/);

  // With an explanation available, the phone points at it rather than asserting a choice was made.
  const explained = researchStatus({ research: true, searchCount: 0, researchNote: "web search is disabled for this account" });
  assert.equal(explained.level, "none");
  assert.equal(explained.note, "web search is disabled for this account");
  assert.doesNotMatch(explained.detail, /chose not to search/);
  assert.match(explained.detail, /where the reason will be/);

  // A run that searched has nothing to explain.
  assert.equal(researchStatus({ research: true, searchCount: 2, searchLog: ["a", "b"], researchNote: "ignored" }).note, "");
});

test("the worker counts a search once across its started and completed events", async () => {
  // Exercises the shipped function rather than a copy of it: recordSearch is lifted out of
  // worker.mjs and run against the event shapes Codex emits.
  const source = await readFile(new URL("../../sandbox/worker.mjs", import.meta.url), "utf8");
  const declaration = /function recordSearch\(event, fallback\) \{[\s\S]*?\n\}/.exec(source);
  assert.ok(declaration, "recordSearch is no longer defined in the worker");

  const searchLog: string[] = [];
  const seenSearches = new Set<string>();
  const build = new Function("searchLog", "seenSearches", "MAX_SEARCH_LOG", `${declaration[0]}\nreturn recordSearch;`);
  const recordSearch = build(searchLog, seenSearches, 50) as (event: unknown, fallback: string) => void;

  // One search, reported twice by the same item id.
  recordSearch({ type: "item.started", item: { id: "ws_1", type: "web_search_call", query: "codex web_search variants" } }, "web_search_call");
  recordSearch({ type: "item.completed", item: { id: "ws_1", type: "web_search_call", query: "codex web_search variants" } }, "web_search_call");
  assert.deepEqual(searchLog, ["codex web_search variants"]);

  // A different query under the nested action shape.
  recordSearch({ type: "item.completed", item: { id: "ws_2", type: "web_search_call", action: { query: "vercel sandbox egress" } } }, "web_search_call");
  assert.deepEqual(searchLog, ["codex web_search variants", "vercel sandbox egress"]);

  // No id and no query still counts, so a shape change undercounts rather than disappears.
  recordSearch({ type: "item.completed", item: { type: "web_search_call" } }, "web_search_call");
  assert.equal(searchLog.length, 3);
  assert.equal(searchLog[2], "web_search_call");

  // Long queries are truncated and the log is bounded.
  recordSearch({ item: { id: "ws_long", query: "q".repeat(400) } }, "web_search_call");
  assert.equal(searchLog[3].length, 200);
  for (let index = 0; index < 100; index += 1) recordSearch({ item: { id: `bulk_${index}`, query: `bulk ${index}` } }, "web_search_call");
  assert.equal(searchLog.length, 50);
});
