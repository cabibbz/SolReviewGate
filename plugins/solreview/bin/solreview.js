#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");

const TERMINAL = "Bob Regress";
// Constant acknowledgement for a parallel answer. Identical on every path, including failure,
// so the assistant that ran the command cannot condition on the outcome.
const PARALLEL_ACK = "Sol has the same question.";
let terminalValue = TERMINAL;
const MAX_PACKET = 8 * 1024 * 1024;
const CHUNK = 512 * 1024;

class TerminalResult extends Error {
  constructor(value) {
    super("terminal");
    this.value = value;
  }
}

function finish(value = terminalValue) {
  throw new TerminalResult(value);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readConfig() {
  const configPath = process.env.SOL_GATE_CONFIG || path.join(os.homedir(), ".sol-review", "remote.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
    const url = String(process.env.SOL_GATE_URL || parsed.url || "").replace(/\/+$/, "");
    const token = String(process.env.SOL_GATE_CLIENT_TOKEN || parsed.token || "");
    if (!url || !token || (!url.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url))) finish();
    return { url, token };
  } catch {
    finish();
  }
}

function isDisposablePacket(file) {
  if (!file || file === "-") return false;
  const resolved = path.resolve(file);
  const name = path.basename(resolved);
  if (name === ".sol-packet.md") return true;
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  return resolved.toLowerCase().startsWith(tempRoot) && /^(?:solreviewpacket[a-f0-9]+|sol-review-packet-[a-f0-9-]+)\.md$/i.test(name);
}

function readPacket(file) {
  try {
    const packet = file && file !== "-" ? fs.readFileSync(file) : fs.readFileSync(0);
    if (!packet.length || packet.length > MAX_PACKET) finish();
    return packet;
  } catch {
    finish();
  } finally {
    if (isDisposablePacket(file)) {
      try { fs.unlinkSync(path.resolve(file)); } catch {}
    }
  }
}

async function request(url, options, timeout = 30_000, retries = 0) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout), cache: "no-store" });
      if (!response.ok) {
        if (attempt < retries && (response.status === 429 || response.status >= 500)) throw new Error("retryable");
        throw new Error("unavailable");
      }
      return response.json();
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

function validOutput(value) {
  if (value === TERMINAL) return true;
  return /^VERDICT: (SOUND|NEEDS_IMPROVEMENT|WRONG)\nCONFIDENCE: (LOW|MEDIUM|HIGH)\nASSESSMENT:\n.+/s.test(value)
    || /^VERDICT: (SOUND|NEEDS_IMPROVEMENT|WRONG)\nASSESSMENT: .+/s.test(value);
}


const ATTACH_HEADING = /^#{1,6}\s*(?:Attached Paths|Granted Paths)\s*$/im;
const MAX_FILE_BYTES = Number(process.env.SOL_ATTACH_MAX_FILE_BYTES || 256 * 1024);
const MAX_TOTAL_BYTES = Number(process.env.SOL_ATTACH_MAX_TOTAL_BYTES || 4 * 1024 * 1024);
const MAX_FILES = Number(process.env.SOL_ATTACH_MAX_FILES || 200);
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo", ".cache", "vendor", "__pycache__", ".venv", "venv", ".vercel"]);
// Files whose whole purpose is to hold a credential are never attached, whatever was declared.
const SECRET_NAMES = /(^|[.\/])(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_rsa.*|id_ed25519.*|\.npmrc|\.netrc|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i;
const SECRET_LINES = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:api[_-]?key|secret|password|passwd|token|authorization)\b\s*[:=]\s*\S{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function declaredPaths(packet) {
  const lines = packet.split(/\r?\n/);
  const start = lines.findIndex((line) => ATTACH_HEADING.test(line));
  if (start < 0) return [];
  const paths = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+\S/.test(line)) break;
    const value = line.replace(/^[-*+]\s*/, "").replace(/^\d+[.)]\s*/, "").trim().replace(/^[`"']|[`"']$/g, "");
    if (value) paths.push(value.split("|")[0].trim());
  }
  return paths;
}

function insideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function collectFiles(root, entry, collected, skipped) {
  const resolved = path.resolve(root, entry);
  if (!insideRoot(root, resolved)) {
    skipped.push(`${entry} (outside the working directory)`);
    return;
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    skipped.push(`${entry} (not found)`);
    return;
  }
  if (stat.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(resolved))) {
      skipped.push(`${entry} (excluded directory)`);
      return;
    }
    let entries = [];
    try { entries = fs.readdirSync(resolved); } catch { skipped.push(`${entry} (unreadable)`); return; }
    for (const child of entries.sort()) collectFiles(root, path.join(resolved, child), collected, skipped);
    return;
  }
  if (!stat.isFile()) return;
  const relative = path.relative(root, resolved).split(path.sep).join("/");
  if (SECRET_NAMES.test(relative)) {
    skipped.push(`${relative} (credential file)`);
    return;
  }
  if (stat.size > MAX_FILE_BYTES) {
    skipped.push(`${relative} (${stat.size} bytes, over the per file limit)`);
    return;
  }
  if (!collected.some((file) => file.relative === relative)) collected.push({ relative, resolved, size: stat.size });
}

function redactSecretLines(content) {
  let redacted = 0;
  const lines = content.split("\n").map((line) => {
    if (SECRET_LINES.some((pattern) => pattern.test(line))) {
      redacted += 1;
      return "[REDACTED LINE]";
    }
    return line;
  });
  return { text: lines.join("\n"), redacted };
}

/**
 * Attaches the files and folders the packet declared. The client reads them, so the reviewer
 * receives the exact bytes on disk rather than a description of them.
 */
function attachDeclaredPaths(packet) {
  const declared = declaredPaths(packet);
  if (!declared.length) return packet;
  const root = process.cwd();
  const collected = [];
  const skipped = [];
  for (const entry of declared) collectFiles(root, entry, collected, skipped);

  const attached = [];
  let total = 0;
  let redactedLines = 0;
  for (const file of collected) {
    if (attached.length >= MAX_FILES) { skipped.push(`${file.relative} (file limit reached)`); continue; }
    if (total + file.size > MAX_TOTAL_BYTES) { skipped.push(`${file.relative} (total size limit reached)`); continue; }
    let raw;
    try { raw = fs.readFileSync(file.resolved); } catch { skipped.push(`${file.relative} (unreadable)`); continue; }
    if (raw.includes(0)) { skipped.push(`${file.relative} (binary)`); continue; }
    const { text, redacted } = redactSecretLines(raw.toString("utf8"));
    redactedLines += redacted;
    total += Buffer.byteLength(text, "utf8");
    attached.push({ relative: file.relative, text, digest: hash(raw) });
  }
  if (!attached.length && !skipped.length) return packet;

  const manifest = [
    "",
    "## Attached File Contents",
    "",
    `The client read these paths from the working directory and reproduced them exactly. Each digest is the SHA-256 of the file on disk. ${attached.length} file(s), ${total} bytes.`,
    redactedLines ? `${redactedLines} line(s) matching credential patterns were replaced with [REDACTED LINE].` : "",
    skipped.length ? `Not attached: ${skipped.join("; ")}.` : "",
    "",
  ].filter((line) => line !== "").join("\n");

  const bodies = attached.map((file) => [
    "",
    `=== BEGIN ATTACHED FILE ${file.relative} sha256:${file.digest} ===`,
    file.text.replace(/\r\n/g, "\n").replace(/^=== (BEGIN|END) ATTACHED FILE/gm, "\\=== $1 ATTACHED FILE"),
    `=== END ATTACHED FILE ${file.relative} ===`,
  ].join("\n")).join("\n");

  return `${packet.replace(/\s*$/, "")}\n${manifest}${bodies}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const parallel = args.includes("--parallel");
  if (parallel) terminalValue = PARALLEL_ACK;
  const file = args.find((arg) => !arg.startsWith("-"));
  const raw = readPacket(file);
  const packet = Buffer.from(attachDeclaredPaths(raw.toString("utf8")), "utf8");
  if (packet.length > MAX_PACKET) finish();
  const { url, token } = readConfig();
  const compressed = gzipSync(packet, { level: 9 });
  if (compressed.length > MAX_PACKET) finish();
  const chunkCount = Math.ceil(compressed.length / CHUNK);
  const initialized = await request(`${url}/api/client/jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      packetHash: hash(packet),
      compressedHash: hash(compressed),
      compressedBytes: compressed.length,
      chunkCount,
      kind: parallel ? "parallel" : "review",
    }),
  });
  if (!initialized.jobId || !initialized.capability) finish();

  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = compressed.subarray(index * CHUNK, (index + 1) * CHUNK);
    await request(`${url}/api/client/jobs/${encodeURIComponent(initialized.jobId)}/chunks/${index}`, {
      method: "PUT",
      headers: { "x-sol-capability": initialized.capability, "content-type": "application/json" },
      body: JSON.stringify({ data: chunk.toString("base64") }),
    }, 30_000, 2);
  }

  await request(`${url}/api/client/jobs/${encodeURIComponent(initialized.jobId)}/commit`, {
    method: "POST",
    headers: { "x-sol-capability": initialized.capability },
  }, 30_000, 2);

  // A parallel answer is recorded for the operator. Nothing is waited for and nothing comes back.
  if (parallel) finish(PARALLEL_ACK);

  // Matches the server's default job lifetime, so the client does not give up on a packet the
  // operator is still allowed to answer.
  const deadline = Date.now() + Number(process.env.SOL_GATE_TIMEOUT_MS || 4 * 60 * 60 * 1000);
  const pollMs = Math.max(25, Number(process.env.SOL_GATE_POLL_MS || 2_000));
  while (Date.now() < deadline) {
    const result = await request(`${url}/api/client/jobs/${encodeURIComponent(initialized.jobId)}/result`, {
      method: "GET",
      headers: { "x-sol-capability": initialized.capability },
    }, 30_000, 2);
    if (!result.pending) {
      if (typeof result.output !== "string" || !validOutput(result.output)) finish();
      finish(result.output);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  finish();
}

main().catch((error) => {
  process.stdout.write(`${error instanceof TerminalResult ? error.value : terminalValue}\n`);
  process.exitCode = 0;
});
