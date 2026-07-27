import { spawn } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";

const MAX_OUTPUT = 4 * 1024 * 1024;
const packetPath = process.argv[2];
const model = process.env.SOL_MODEL || "gpt-5.6-sol";
const reasoning = process.env.SOL_REASONING || "medium";
const policy = Buffer.from(process.env.SOL_GATE_POLICY_BASE64 || "", "base64").toString("utf8");
const outputSchema = /^\/opt\/solgate\/[a-z-]+\.json$/.test(process.env.SOL_OUTPUT_SCHEMA || "") ? process.env.SOL_OUTPUT_SCHEMA : "/opt/solgate/review-schema.json";
const research = process.env.SOL_RESEARCH === "1";

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
  // Codex accepts disabled, cached, indexed, or live. "live" is the only one that reaches the web,
  // and --strict-config turns any other value into an immediate config load failure.
  "-c", `web_search="${research ? "live" : "disabled"}"`,
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
      const activity = `${eventType} ${itemType}`;
      // A researched run may search the web. Everything else still ends the run immediately.
      const searching = research && /web_search|search/i.test(activity) && !/command|shell|exec|file_change|mcp|patch|apply/i.test(activity);
      if (!searching && /command|tool|web_search|mcp|file_change/i.test(activity)) {
        toolAttempt = true;
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
  // The queries leave this sandbox, so the operator sees exactly what left. Phone only, like the
  // rest of the candidate record.
  searchLog: searchLog.map((entry) => redact(entry, secrets)),
};
await writeFile(`/tmp/sol-review-result.json`, JSON.stringify(envelope), { mode: 0o600 });
process.stdout.write(JSON.stringify({ ready: true, exitCode, toolAttempt, secretLeak }));
