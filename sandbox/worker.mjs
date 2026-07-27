import { spawn } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";

const MAX_OUTPUT = 4 * 1024 * 1024;
const packetPath = process.argv[2];
const model = process.env.SOL_MODEL || "gpt-5.6-sol";
const reasoning = process.env.SOL_REASONING || "medium";
const policy = Buffer.from(process.env.SOL_GATE_POLICY_BASE64 || "", "base64").toString("utf8");
const outputSchema = /^\/opt\/solgate\/[a-z-]+\.json$/.test(process.env.SOL_OUTPUT_SCHEMA || "") ? process.env.SOL_OUTPUT_SCHEMA : "/opt/solgate/review-schema.json";
const research = process.env.SOL_RESEARCH === "1";
// `live` fetches pages from the open web, which a read-only sandbox with restricted egress cannot
// do: the search returns nothing and the reviewer reports that it found no usable source. `cached`
// and `indexed` are served from OpenAI's own index over the connection the model already has, so
// they work here. Default to cached; a deployment with full egress can ask for live.
const researchMode = ["cached", "indexed", "live"].includes(process.env.SOL_RESEARCH_MODE || "") ? process.env.SOL_RESEARCH_MODE : "cached";

function redact(value, secrets) {
  let output = String(value || "");
  for (const secret of secrets) {
    if (secret.length >= 8) output = output.split(secret).join("[REDACTED]");
  }
  return output
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]");
}

async function authSecrets() {
  try {
    const parsed = JSON.parse(await readFile(`${process.env.HOME}/.codex/auth.json`, "utf8"));
    const found = [];
    const visit = (value) => {
      if (typeof value === "string") found.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(parsed);
    return found.filter((value) => value.length >= 8);
  } catch {
    return [];
  }
}

// One entry per distinct search. Codex emits a started and a completed event for the same item, so
// the item id deduplicates the pair; without one, the query text or a positional key stands in.
function recordSearch(event, fallback) {
  const item = event.item || {};
  const query = [item.query, item.action?.query, item.search_query, event.query]
    .find((value) => typeof value === "string" && value.trim());
  const key = String(item.id || query || `${fallback}:${searchLog.length}`);
  if (seenSearches.has(key) || searchLog.length >= MAX_SEARCH_LOG) return;
  seenSearches.add(key);
  searchLog.push(String(query || fallback).slice(0, 200));
}

const packet = await readFile(packetPath, "utf8");
if (!policy || !packet.trim()) process.exit(31);
const prompt = `${policy.trim()}\n\n=== BEGIN UNTRUSTED REVIEW PACKET ===\n${packet}\n=== END UNTRUSTED REVIEW PACKET ===\n`;
const secrets = await authSecrets();
const childEnv = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  LANG: "C.UTF-8",
  CODEX_HOME: `${process.env.HOME}/.codex`,
};
const args = [
  "exec", "--json", "--ephemeral", "--color", "never",
  "--strict-config", "--dangerously-bypass-hook-trust",
  "--model", model,
  "-c", `model_reasoning_effort=\"${reasoning}\"`,
  // Web search is on by default in Codex, and `web_search` is the only control. The same value is
  // written into this run's config.toml, so the two agree and no override precedence is assumed.
  "-c", `web_search="${research ? researchMode : "disabled"}"`,
  "-c", "approval_policy=\"never\"",
  "--sandbox", "read-only",
  "--skip-git-repo-check",
  "--output-schema", outputSchema,
  "-",
];

let stdout = "";
let stderr = "";
let finalText = "";
let toolAttempt = false;
let malformedEvents = false;
// Every distinct kind of thing this run emitted, and what ended it if anything did. Guessing the
// vocabulary from documentation has been wrong repeatedly; one real run reports it instead.
const observedItems = new Set();
let blockedBy = "";
// Observed searches, counted from the transport stream rather than taken from the model's own
// account of what it did. A run that claims sources it never looked up is visible by comparison.
const searchLog = [];
const seenSearches = new Set();
const MAX_SEARCH_LOG = 50;
let writeQueue = Promise.resolve();
const child = spawn("codex", args, { cwd: "/tmp/sol-review-empty", env: childEnv, stdio: ["pipe", "pipe", "pipe"] });

child.stdout.setEncoding("utf8");
child.stdout.on("data", async (chunk) => {
  stdout += chunk;
  if (Buffer.byteLength(stdout) > MAX_OUTPUT) child.kill("SIGKILL");
  const lines = stdout.split("\n");
  stdout = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const eventType = String(event.type || "");
      const itemType = String(event.item?.type || "");
      const itemMessage = String(event.item?.message || "");
      if (itemType === "error" && itemMessage.includes("--dangerously-bypass-hook-trust")) continue;
      if (itemType || eventType) observedItems.add(itemType ? `item:${itemType}` : `event:${eventType}`);
      // Deny by default: the benign set is enumerated, so a tool type nobody anticipated ends the
      // run rather than passing unnoticed. Matching is on a substring, because the exact names are
      // not reliably documented -- a search has been seen as both `web_search` and `web_search_call`
      // -- and an anchored list would terminate the very run it is supposed to permit.
      const benignItem = /^(agent_message|reasoning|agent_reasoning|todo_list|plan|error|token_count|usage)/i.test(itemType);
      // Matched the same way the deny hook matches, and for the same reason: the tool is called
      // `webrun`, not `web_search`, and a list of guessed names blocked every search for the life
      // of the feature. Reading the web is permitted; anything that could act is not, whatever it
      // is called. Kept deliberately in step with sandbox/block-tools.py.
      const searching = research && /web|search|browse|fetch|http|url/i.test(itemType)
        && !/shell|exec|command|apply|patch|write|edit|create|delete|remove|move|copy|mcp|bash|python|node|process|kill|spawn|file|dir|path/i.test(itemType);
      const structural = !itemType && /^(thread\.|turn\.|item\.|error|session)/i.test(eventType);
      if (!benignItem && !searching && !structural) {
        toolAttempt = true;
        // Naming what stopped the run is the difference between a diagnosis and another guess.
        if (!blockedBy) blockedBy = itemType ? `item type "${itemType}"` : `event "${eventType}"`;
        child.kill("SIGKILL");
      }
      if (searching) recordSearch(event, itemType || eventType);
      if (itemType === "agent_message" && typeof event.item?.text === "string") finalText = event.item.text;
      if (eventType === "agent_message" && typeof event.text === "string") finalText = event.text;
      const safeEvent = redact(JSON.stringify({ ...event, sol_observed_at: Date.now() }), secrets);
      writeQueue = writeQueue.then(() => appendFile("/tmp/sol-review-live.ndjson", `${safeEvent}\n`, { mode: 0o600 }));
    } catch {
      malformedEvents = true;
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
  if (Buffer.byteLength(stderr) > MAX_OUTPUT) child.kill("SIGKILL");
});

child.stdin.end(prompt);
const exitCode = await new Promise((resolve) => {
  const timer = setTimeout(() => child.kill("SIGKILL"), 5 * 60 * 1000);
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve(code ?? 255);
  });
  child.on("error", () => {
    clearTimeout(timer);
    resolve(255);
  });
});

const redactedFinal = redact(finalText, secrets);
await writeQueue;
const secretLeak = secrets.some((secret) => finalText.includes(secret));
const envelope = {
  version: 1,
  exitCode,
  toolAttempt,
  malformedEvents,
  secretLeak,
  candidate: redactedFinal,
  diagnostics: redact(stderr, secrets).slice(-12_000),
  research,
  // What the run actually emitted, so the next failure is read rather than inferred.
  observedItems: [...observedItems].slice(0, 40),
  blockedBy,
  researchMode: research ? researchMode : "",
  // The queries leave this sandbox, so the operator sees exactly what left. Phone only, like the
  // rest of the candidate record.
  searchLog: searchLog.map((entry) => redact(entry, secrets)),
};
await writeFile(`/tmp/sol-review-result.json`, JSON.stringify(envelope), { mode: 0o600 });
process.stdout.write(JSON.stringify({ ready: true, exitCode, toolAttempt, secretLeak }));
