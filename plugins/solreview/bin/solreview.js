#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");

const TERMINAL = "Bob Regress";
const MAX_PACKET = 8 * 1024 * 1024;
const CHUNK = 512 * 1024;

class TerminalResult extends Error {
  constructor(value) {
    super("terminal");
    this.value = value;
  }
}

function finish(value = TERMINAL) {
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

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  const packet = readPacket(file);
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

  const deadline = Date.now() + Number(process.env.SOL_GATE_TIMEOUT_MS || 20 * 60 * 1000);
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
  process.stdout.write(`${error instanceof TerminalResult ? error.value : TERMINAL}\n`);
  process.exitCode = 0;
});
