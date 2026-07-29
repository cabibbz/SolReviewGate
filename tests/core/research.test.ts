import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileEvidence, researchStatus } from "../../lib/research";

test("a packet-only run and a research run that searched nothing are not the same thing", () => {
  assert.equal(researchStatus({ research: false }).level, "off");
  assert.equal(researchStatus(null).level, "off");
  assert.equal(researchStatus(undefined).level, "off");

  const none = researchStatus({ research: true, searchCount: 0 });
  assert.equal(none.level, "none");
  assert.match(none.detail, /no search was recorded/i);

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
  assert.match(fabricated.detail, /No search was recorded/);
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
  assert.match(plain.detail, /no search was recorded/i);

  // With an explanation available, the phone points at it rather than asserting a choice was made.
  const explained = researchStatus({ research: true, searchCount: 0, researchNote: "web search is disabled for this account" });
  assert.equal(explained.level, "none");
  assert.equal(explained.note, "web search is disabled for this account");
  assert.doesNotMatch(explained.detail, /chose not to/);
  assert.match(explained.detail, /not always reported as an event/);

  // A run that searched has nothing to explain.
  assert.equal(researchStatus({ research: true, searchCount: 2, searchLog: ["a", "b"], researchNote: "ignored" }).note, "");
});

test("the worker counts a search once across its started and completed events", async () => {
  // Exercises the shipped function rather than a copy of it: recordSearch is lifted out of
  // worker.mjs and run against the event shapes Codex emits.
  const source = await readFile(new URL("../../sandbox/worker.mjs", import.meta.url), "utf8");
  // recordSearch and the helpers it leans on, lifted whole so the shipped code is what runs here.
  const lifted = ["const QUERY_KEY =", "function findQuery(", "function describeShape(", "function searchEntry(", "function recordSearch("]
    .map((start) => {
      const from = source.indexOf(start);
      assert.notEqual(from, -1, `${start} is no longer defined in the worker`);
      const end = source.indexOf("\n}", from);
      return start.startsWith("const") ? source.slice(from, source.indexOf("\n", from)) : source.slice(from, end + 2);
    })
    .join("\n\n");

  const searchLog: string[] = [];
  const seenSearches = new Set<string>();
  const build = new Function("searchLog", "seenSearches", "MAX_SEARCH_LOG", `${lifted}\nreturn recordSearch;`);
  const recordSearch = build(searchLog, seenSearches, 50) as (event: unknown, fallback: string) => void;

  // One search, reported twice by the same item id.
  // Both spellings have been seen for a search item, and the guard matches on a substring for
  // exactly that reason: an anchored list would terminate the run it is meant to permit.
  const searchGuard = (itemType: string) => /web_search|web_fetch|browser_search/i.test(itemType);
  for (const itemType of ["web_search", "web_search_call", "web_search_request", "web_fetch"]) {
    assert.ok(searchGuard(itemType), `${itemType} is not recognised as a search`);
  }
  assert.ok(!searchGuard("command_execution"));
  assert.ok(!searchGuard("apply_patch"));

  recordSearch({ type: "item.started", item: { id: "ws_1", type: "web_search_call", query: "codex web_search variants" } }, "web_search_call");
  recordSearch({ type: "item.completed", item: { id: "ws_1", type: "web_search_call", query: "codex web_search variants" } }, "web_search_call");
  assert.deepEqual(searchLog, ["codex web_search variants"]);

  // A different query under the nested action shape.
  recordSearch({ type: "item.completed", item: { id: "ws_2", type: "web_search_call", action: { query: "vercel sandbox egress" } } }, "web_search_call");
  assert.deepEqual(searchLog, ["codex web_search variants", "vercel sandbox egress"]);

  // No id and no query still counts, so a shape change undercounts rather than disappears.
  recordSearch({ type: "item.completed", item: { type: "web_search_call", status: "ok" } }, "web_search_call");
  assert.equal(searchLog.length, 3);
  // A search whose query cannot be located names the fields that were present, so the next run
  // corrects the extractor instead of showing a tool name where a query belongs.
  assert.match(searchLog[2], /web_search_call \(query text not found; fields: type, status\)/);

  // Long queries are truncated and the log is bounded.
  recordSearch({ item: { id: "ws_long", query: "q".repeat(400) } }, "web_search_call");
  assert.equal(searchLog[3].length, 200);
  for (let index = 0; index < 100; index += 1) recordSearch({ item: { id: `bulk_${index}`, query: `bulk ${index}` } }, "web_search_call");
  assert.equal(searchLog.length, 50);
});

test("file evidence takes the reviewer's own list, not a guess from prose", () => {
  // The reviewer commits to filesReferenced -- an array of attached paths it relied on. That
  // structured commitment is what the phone counts, and a fabrication (a path that was not
  // attached) is rejected by the gate before it reaches this function.
  const paths = ["DmaKit/overlay.cpp", "DmaKit/vdm.cpp", "src/untouched.ts"];

  const used = fileEvidence(3, 40_960, paths, ["DmaKit/vdm.cpp", "DmaKit/overlay.cpp"]);
  assert.equal(used.attached, 3);
  assert.equal(used.cited, 2);
  assert.deepEqual(used.citedPaths.sort(), ["DmaKit/overlay.cpp", "DmaKit/vdm.cpp"]);
  assert.deepEqual(used.uncitedPaths, ["src/untouched.ts"]);

  // A path the reviewer names that is not in the attached list is ignored here, since the gate
  // already rejects the review. Belt and suspenders, and the count stays honest.
  assert.equal(fileEvidence(1, 10, ["a/b/c/deep.ts"], ["../elsewhere.ts"]).cited, 0);
  // Duplicates in the reviewer's list do not double count.
  assert.equal(fileEvidence(1, 10, ["one.ts"], ["one.ts", "one.ts"]).cited, 1);
  // Leading ./ is normalised on both sides.
  assert.equal(fileEvidence(1, 10, ["./one.ts"], ["one.ts"]).cited, 1);

  const ignored = fileEvidence(2, 100, ["one.ts", "two.ts"], []);
  assert.equal(ignored.cited, 0);
  assert.equal(ignored.uncitedPaths.length, 2);

  assert.equal(fileEvidence(7, 2_048, [], []).attached, 7);
  assert.equal(fileEvidence(0, 0, [], []).attached, 0);
  assert.equal(fileEvidence(0, 0, [], []).level, "none");
  assert.equal(used.level, "partial");
  assert.equal(ignored.level, "unused");
  assert.equal(fileEvidence(2, 10, ["one.ts", "two.ts"], ["one.ts", "two.ts"]).level, "used");
});
