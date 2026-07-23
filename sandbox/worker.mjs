import { spawn } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";

const MAX_OUTPUT = 4 * 1024 * 1024;
const packetPath = process.argv[2];
const model = process.env.SOL_MODEL || "gpt-5.6-sol";
const reasoning = process.env.SOL_REASONING || "medium";
const policy = Buffer.from(process.env.SOL_GATE_POLICY_BASE64 || "", "base64").toString("utf8");

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
  "-c", "web_search=\"disabled\"",
  "-c", "approval_policy=\"never\"",
  "--sandbox", "read-only",
  "--skip-git-repo-check",
  "--output-schema", "/opt/solgate/review-schema.json",
  "-",
];

let stdout = "";
let stderr = "";
let finalText = "";
let toolAttempt = false;
let malformedEvents = false;
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
      if (/command|tool|web_search|mcp|file_change/i.test(`${eventType} ${itemType}`)) {
        toolAttempt = true;
        child.kill("SIGKILL");
      }
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
};
await writeFile(`/tmp/sol-review-result.json`, JSON.stringify(envelope), { mode: 0o600 });
process.stdout.write(JSON.stringify({ ready: true, exitCode, toolAttempt, secretLeak }));
