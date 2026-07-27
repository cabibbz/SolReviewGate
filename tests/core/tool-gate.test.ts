import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * The gate that refused every search for the life of the research feature. Codex names its web tool
 * `webrun`; the hook's allowlist named `web_search`, so it denied the one tool it existed to permit
 * and said so in a log nobody was reading. These tests run the real hook and the real worker rule
 * against the tool names a production run actually produced.
 */

const hookSource = readFileSync(path.join(process.cwd(), "sandbox", "block-tools.py"), "utf8");
const workerSource = readFileSync(path.join(process.cwd(), "sandbox", "worker.mjs"), "utf8");

function hookDecision(toolName: string, researching: boolean): { decision: string; reason: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "sol-hook-"));
  const marker = path.join(root, "research-enabled");
  if (researching) writeFileSync(marker, "1");
  const script = path.join(root, "hook.py");
  writeFileSync(script, hookSource.replace('"/opt/solgate/research-enabled"', JSON.stringify(marker)));
  try {
    const output = execFileSync("python3", [script], { input: JSON.stringify({ tool_name: toolName }), encoding: "utf8" });
    const parsed = JSON.parse(output).hookSpecificOutput;
    return { decision: parsed.permissionDecision, reason: parsed.permissionDecisionReason };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Mirrors sandbox/worker.mjs. The parity test below fails if the two ever drift.
function workerAllowsSearch(itemType: string, research: boolean): boolean {
  return research
    && /web|search|browse|fetch|http|url/i.test(itemType)
    && !/shell|exec|command|apply|patch|write|edit|create|delete|remove|move|copy|mcp|bash|python|node|process|kill|spawn|file|dir|path/i.test(itemType);
}

const readsTheWeb = ["webrun", "web_search", "web_search_call", "web_search_preview", "browser_search", "web_fetch"];
const canAct = ["shell", "unified_exec", "command_execution", "apply_patch", "file_change", "mcp_tool_call", "mcp__server__search_files", "read_file", "list_dir", "view_image", "web_write"];

test("the deny hook permits the tool Codex actually uses for search", () => {
  // `webrun` is the name from a production log. Everything else here is a name this project has
  // guessed at some point, kept so a rename cannot quietly break the feature again.
  for (const tool of readsTheWeb) {
    assert.equal(hookDecision(tool, true).decision, "allow", `${tool} is refused in a researched run`);
  }
});

test("the deny hook refuses anything able to act, in both modes", () => {
  for (const tool of canAct) {
    assert.equal(hookDecision(tool, true).decision, "deny", `${tool} was permitted in a researched run`);
    assert.equal(hookDecision(tool, false).decision, "deny", `${tool} was permitted in a packet-only run`);
  }
  // An MCP tool whose name contains "search" cannot borrow the research allowance.
  assert.equal(hookDecision("mcp__server__search_files", true).decision, "deny");
});

test("a packet-only run permits nothing at all, including search", () => {
  for (const tool of readsTheWeb) {
    assert.equal(hookDecision(tool, false).decision, "deny", `${tool} ran in a packet-only review`);
  }
  assert.equal(hookDecision("", false).decision, "deny", "an unnamed tool was permitted");
  assert.equal(hookDecision("", true).decision, "deny", "an unnamed tool was permitted in a researched run");
});

test("a refusal names the tool it refused", () => {
  // The block that finally explained this was readable only because Codex logged the tool name.
  assert.match(hookDecision("webrun", false).reason, /webrun/);
  assert.match(hookDecision("apply_patch", true).reason, /apply_patch/);
});

test("the worker's guard agrees with the hook, tool for tool", () => {
  // Two gates written in two languages that must not drift: the hook decides whether a tool runs,
  // the worker decides whether the run survives having used it. Disagreement means a search is
  // permitted and then terminated, or terminated and then permitted.
  for (const tool of readsTheWeb) {
    assert.equal(workerAllowsSearch(tool, true), true, `the worker would terminate a run using ${tool}`);
    assert.equal(workerAllowsSearch(tool, false), false, `${tool} survived a packet-only run`);
  }
  for (const tool of canAct) {
    assert.equal(workerAllowsSearch(tool, true), false, `${tool} survived a researched run`);
  }
});

test("the hook records every call it sees, with the query", () => {
  // The observation point moved here because a `webrun` call produces no item in the event stream:
  // a run whose two calls were refused emitted only thread, turn, and message events. Counting
  // searches from that stream reports zero on a run that searched perfectly.
  const root = mkdtempSync(path.join(os.tmpdir(), "sol-hook-log-"));
  const marker = path.join(root, "research-enabled");
  const log = path.join(root, "calls.ndjson");
  writeFileSync(marker, "1");
  const script = path.join(root, "hook.py");
  writeFileSync(script, hookSource
    .replace('"/opt/solgate/research-enabled"', JSON.stringify(marker))
    .replace('"/tmp/sol-tool-calls.ndjson"', JSON.stringify(log)));

  try {
    for (const payload of [
      { tool_name: "webrun", tool_input: { query: "is gpt-5.4-mini still supported" } },
      { tool_name: "webrun", tool_input: { query: "windows capture semantics" } },
      { tool_name: "apply_patch", tool_input: { path: "src/one.ts" } },
    ]) {
      execFileSync("python3", [script], { input: JSON.stringify(payload), encoding: "utf8" });
    }

    const entries = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.filter((entry) => entry.decision === "allow").map((entry) => entry.query), [
      "is gpt-5.4-mini still supported",
      "windows capture semantics",
    ]);
    const refused = entries.find((entry) => entry.decision === "deny");
    assert.equal(refused.tool, "apply_patch");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failure to record can never turn into a failure to gate", () => {
  // Observation must not be able to break the decision, so the log path is deliberately unwritable.
  const root = mkdtempSync(path.join(os.tmpdir(), "sol-hook-fail-"));
  const marker = path.join(root, "research-enabled");
  writeFileSync(marker, "1");
  const script = path.join(root, "hook.py");
  writeFileSync(script, hookSource
    .replace('"/opt/solgate/research-enabled"', JSON.stringify(marker))
    .replace('"/tmp/sol-tool-calls.ndjson"', JSON.stringify("/proc/nonexistent/calls.ndjson")));

  try {
    const allow = JSON.parse(execFileSync("python3", [script], { input: JSON.stringify({ tool_name: "webrun" }), encoding: "utf8" }));
    assert.equal(allow.hookSpecificOutput.permissionDecision, "allow");
    const deny = JSON.parse(execFileSync("python3", [script], { input: JSON.stringify({ tool_name: "shell" }), encoding: "utf8" }));
    assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("both gates carry the same rule, so neither can be relaxed alone", () => {
  const pattern = /READS_THE_WEB = re\.compile\(r"([^"]+)"/.exec(hookSource);
  assert.ok(pattern, "the hook no longer declares a read-family pattern");
  assert.ok(workerSource.includes(pattern[1]), "the worker and the hook have drifted apart");
});
