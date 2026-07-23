import { readFile } from "node:fs/promises";
import path from "node:path";
import { Sandbox, Snapshot } from "@vercel/sandbox";
import { config } from "@/lib/config";
import { sha256 } from "@/lib/crypto";
import { analyzeInternalReview, filterInternalReview, normalizeOutput, OPAQUE_OUTPUT } from "@/lib/gate";
import { adminGetJob, adminLiveLog, appendJobEvents, readPacket, saveLiveLog, saveTerminalResult, transitionJob } from "@/lib/jobs";
import { getStore, type Store } from "@/lib/store";
import type { ReviewEvent, ReviewJob } from "@/lib/types";

interface SandboxBase {
  snapshotId: string;
  createdAt: number;
  codexVersion: string;
}

interface RunningCommand {
  sandboxId: string;
  commandId: string;
  kind: "login" | "review";
  jobId?: string;
  createdAt: number;
}

interface DeviceLoginStatus {
  state: "idle" | "running" | "finalizing" | "ready" | "failed";
  output?: string;
  deviceUrl?: string;
  userCode?: string;
  expiresAt?: number;
}

interface WorkerEnvelope {
  version: number;
  exitCode: number;
  toolAttempt: boolean;
  malformedEvents: boolean;
  secretLeak: boolean;
  candidate: string;
  diagnostics: string;
}

const baseKey = "sol:sandbox:base";
const loginKey = "sol:sandbox:login";
const loginResultKey = "sol:sandbox:login-result";
const finalizeLockKey = "sol:sandbox:finalize-lock";
const pollLockKey = "sol:sandbox:login-poll-lock";
const baseTtlSeconds = 29 * 24 * 60 * 60;

function jobTtl(job: ReviewJob): number {
  return Math.max(1, Math.ceil((job.expiresAt - Date.now()) / 1000));
}

function eventText(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        return eventText(JSON.parse(text), depth + 1) || text.slice(0, 400_000);
      } catch {
        // Plain text can begin with punctuation without being JSON.
      }
    }
    return text.slice(0, 400_000);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => eventText(item, depth + 1)).filter(Boolean).join("\n").slice(0, 400_000) || undefined;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "review") {
      const assessment = eventText(record.assessment, depth + 1);
      const confidence = eventText(record.confidence, depth + 1);
      const evidence = Array.isArray(record.evidenceCited)
        ? record.evidenceCited.map((item) => eventText(item, depth + 1)).filter(Boolean)
        : [];
      const counterargument = eventText(record.counterargument, depth + 1);
      const recommendations = Array.isArray(record.recommendations)
        ? record.recommendations.map((item) => eventText(item, depth + 1)).filter(Boolean)
        : [];
      const verdict = eventText(record.verdict, depth + 1);
      return [
        verdict ? `Verdict: ${verdict}` : undefined,
        confidence ? `Confidence: ${confidence}` : undefined,
        assessment,
        evidence.length ? `Evidence cited:\n${evidence.map((item) => `- ${item}`).join("\n")}` : undefined,
        counterargument ? `Counterargument:\n${counterargument}` : undefined,
        recommendations.length ? `Recommendations:\n${recommendations.map((item) => `- ${item}`).join("\n")}` : undefined,
      ].filter(Boolean).join("\n\n").slice(0, 400_000) || undefined;
    }
    if (record.kind === "opaque") return eventText(record.withheldReason ?? record.assessment, depth + 1) || "Codex returned no substantive review for release.";
    const primary = record.message ?? record.text ?? record.summary ?? record.error ?? record.content;
    const message = eventText(primary, depth + 1);
    const code = typeof record.code === "string" ? record.code : undefined;
    if (message) return `${message}${code && !message.includes(code) ? `\nCode: ${code}` : ""}`.slice(0, 400_000);
    return Object.entries(record)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => `${key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())}: ${item}`)
      .join("\n")
      .slice(0, 400_000) || undefined;
  }
  return undefined;
}

export function normalizeCodexEvents(value: string, fallbackAt = Date.now()): ReviewEvent[] {
  return value.split("\n").flatMap<ReviewEvent>((line, index): ReviewEvent[] => {
    if (!line.trim()) return [];
    try {
      const event = JSON.parse(line) as Record<string, unknown> & { item?: Record<string, unknown>; usage?: Record<string, unknown> };
      const type = String(event.type || "event");
      const itemType = String(event.item?.type || "");
      const at = typeof event.sol_observed_at === "number" ? event.sol_observed_at : fallbackAt + index;
      const base = { id: `codex:${index}:${sha256(line).slice(0, 12)}`, at, raw: line.slice(0, 50_000) };
      if (type === "thread.started") return [{ ...base, source: "codex", level: "info", title: "Codex session started" } satisfies ReviewEvent];
      if (type === "turn.started") return [{ ...base, source: "codex", level: "info", title: "Model review started" } satisfies ReviewEvent];
      if (type === "turn.completed") {
        const usage = event.usage || {};
        return [{ ...base, source: "usage", level: "success", title: "Model review completed", usage: {
          inputTokens: Number(usage.input_tokens) || 0,
          cachedInputTokens: Number(usage.cached_input_tokens) || 0,
          outputTokens: Number(usage.output_tokens) || 0,
          reasoningOutputTokens: Number(usage.reasoning_output_tokens) || 0,
        } } satisfies ReviewEvent];
      }
      if (type === "turn.failed" || type === "error" || itemType === "error") {
        return [{ ...base, source: "error", level: "error", title: "Codex error", message: eventText(event.item?.message || event.error || event.message) } satisfies ReviewEvent];
      }
      if (itemType === "agent_message") {
        return [{ ...base, source: "codex", level: "success", title: "Codex completed its response", message: eventText(event.item?.text ?? event.item?.content ?? event.item?.message) } satisfies ReviewEvent];
      }
      if (/reasoning|analysis/i.test(itemType)) {
        return [{ ...base, source: "codex", level: "info", title: "Analysis update", message: eventText(event.item?.text ?? event.item?.summary ?? event.item?.content) } satisfies ReviewEvent];
      }
      if (type === "agent_message" || /reasoning|analysis/.test(type)) {
        return [{ ...base, source: "codex", level: type === "agent_message" ? "success" : "info", title: type === "agent_message" ? "Codex completed its response" : "Analysis update", message: eventText(event.text ?? event.summary ?? event.content ?? event.message) } satisfies ReviewEvent];
      }
      return [{ ...base, source: "codex", level: "info", title: itemType ? `Codex ${itemType.replaceAll("_", " ")}` : type.replaceAll(".", " "), message: eventText(event.item ?? event.message) } satisfies ReviewEvent];
    } catch {
      return [];
    }
  });
}

async function sandboxLiveLog(sandbox: Sandbox): Promise<string> {
  try {
    return (await sandbox.fs.readFile("/tmp/sol-review-live.ndjson", "utf8")).slice(-500_000);
  } catch {
    return "";
  }
}

async function persistLiveReview(job: ReviewJob, sandbox: Sandbox, store: Store): Promise<string> {
  const data = await sandboxLiveLog(sandbox);
  if (!data) return "";
  await Promise.all([
    saveLiveLog(job.id, data, jobTtl(job), store),
    appendJobEvents(job.id, normalizeCodexEvents(data, job.startedAt || job.createdAt), store, jobTtl(job)),
  ]);
  return data;
}

function baseIsCurrent(base: SandboxBase | null): base is SandboxBase {
  return Boolean(base && Date.now() - base.createdAt < baseTtlSeconds * 1000);
}

async function asset(name: string): Promise<Buffer> {
  return readFile(path.join(process.cwd(), "sandbox", name));
}

async function writeRuntimeAssets(sandbox: Sandbox): Promise<void> {
  await sandbox.fs.mkdir("/opt/solgate", { recursive: true });
  await sandbox.fs.mkdir("/tmp/sol-review-empty", { recursive: true });
  await sandbox.fs.mkdir("/home/vercel-sandbox/.codex", { recursive: true });
  const files = await Promise.all(["worker.mjs", "block-tools.py", "config.toml", "review-schema.json"].map(async (name) => ({
    path: name === "config.toml" ? "/home/vercel-sandbox/.codex/config.toml" : `/opt/solgate/${name}`,
    content: await asset(name),
    mode: name.endsWith(".py") ? 0o700 : 0o600,
  })));
  await sandbox.writeFiles(files);
}

async function provision(sandbox: Sandbox): Promise<void> {
  await writeRuntimeAssets(sandbox);
  const version = process.env.SOL_CODEX_VERSION || "0.144.6";
  const install = await sandbox.runCommand("npm", ["install", "-g", `@openai/codex@${version}`]);
  if (install.exitCode !== 0) throw new Error("CODEX_INSTALL_FAILED");
}

export async function sandboxStatus(store: Store = getStore()): Promise<{ configured: boolean; login?: RunningCommand }> {
  const base = await store.get<SandboxBase>(baseKey);
  return {
    configured: baseIsCurrent(base),
    login: (await store.get<RunningCommand>(loginKey)) || undefined,
  };
}

export async function startDeviceLogin(store: Store = getStore()): Promise<RunningCommand> {
  const existing = await store.get<RunningCommand>(loginKey);
  if (existing) return existing;
  if (config.mockSandbox) {
    const mock = { sandboxId: "mock", commandId: "mock-login", kind: "login" as const, createdAt: Date.now() };
    await store.set(loginKey, mock, 900);
    return mock;
  }
  const lock = await store.setIfAbsent("sol:sandbox:setup-lock", true, 900);
  if (!lock) throw new Error("SETUP_BUSY");
  await store.del(loginResultKey, finalizeLockKey, pollLockKey);
  let sandbox: Sandbox | null = null;
  try {
    sandbox = await Sandbox.create({ runtime: "node24", timeout: 15 * 60 * 1000 });
    await provision(sandbox);
    const command = await sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", "codex login --device-auth > /tmp/sol-login.log 2>&1; printf '%s' $? > /tmp/sol-login.exit"],
      detached: true,
    });
    const running: RunningCommand = { sandboxId: sandbox.sandboxId, commandId: command.cmdId, kind: "login", createdAt: Date.now() };
    await store.set(loginKey, running, 900);
    return running;
  } catch (error) {
    if (sandbox) await sandbox.stop({ blocking: false }).catch(() => undefined);
    await store.del("sol:sandbox:setup-lock");
    throw error;
  }
}

export function parseDeviceLoginOutput(value: string): { output: string; deviceUrl?: string; userCode?: string } {
  const output = normalizeOutput(value).replace(/\b(?:access|refresh)[_-]?token\s*[:=]\s*\S+/gi, "[REDACTED]").slice(-12_000);
  return {
    output,
    deviceUrl: output.match(/https:\/\/auth\.openai\.com\/codex\/device\b/i)?.[0],
    userCode: output.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/)?.[0],
  };
}

export function parseLoginExitMarker(value: string): number | null {
  const marker = value.trim();
  if (!/^-?\d+$/.test(marker)) return null;
  const code = Number(marker);
  return Number.isSafeInteger(code) ? code : null;
}

export function hasUsableCodexAuth(value: string): boolean {
  try {
    const auth = JSON.parse(value) as { auth_mode?: unknown; OPENAI_API_KEY?: unknown; tokens?: unknown };
    if (!auth || typeof auth !== "object" || typeof auth.auth_mode !== "string") return false;
    const hasApiKey = typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.length > 0;
    const hasTokens = Boolean(auth.tokens && typeof auth.tokens === "object" && Object.keys(auth.tokens).length > 0);
    return hasApiKey || hasTokens;
  } catch {
    return false;
  }
}

export async function pollDeviceLogin(store: Store = getStore()): Promise<DeviceLoginStatus> {
  const running = await store.get<RunningCommand>(loginKey);
  if (!running) {
    if (baseIsCurrent(await store.get<SandboxBase>(baseKey))) return { state: "ready", output: "Codex account connected." };
    return (await store.get<DeviceLoginStatus>(loginResultKey)) || { state: "idle" };
  }
  if (config.mockSandbox) {
    await store.set(baseKey, { snapshotId: "mock-snapshot", createdAt: Date.now(), codexVersion: "mock" }, baseTtlSeconds);
    await store.del(loginKey, loginResultKey, "sol:sandbox:setup-lock", finalizeLockKey, pollLockKey);
    return { state: "ready", output: "Mock Codex login completed." };
  }
  if (!(await store.setIfAbsent(pollLockKey, true, 30))) {
    const finalizing = await store.get<boolean>(finalizeLockKey);
    return finalizing
      ? { state: "finalizing", output: "Securing the authenticated Codex session." }
      : { state: "running", expiresAt: running.createdAt + 15 * 60 * 1000 };
  }
  try {
    const sandbox = await Sandbox.get({ sandboxId: running.sandboxId });
    let exitMarker = "";
    try {
      exitMarker = await sandbox.fs.readFile("/tmp/sol-login.exit", "utf8");
    } catch {
      // The login shell writes this marker only after Codex has fully exited.
    }
    const exitCode = parseLoginExitMarker(exitMarker);
    if (Date.now() - running.createdAt > 15 * 60 * 1000 && exitCode === null) {
      const command = await sandbox.getCommand(running.commandId);
      await command.kill("SIGTERM").catch(() => undefined);
      await sandbox.stop({ blocking: false }).catch(() => undefined);
      const failure: DeviceLoginStatus = { state: "failed", output: "The device code expired. Start a new Codex connection." };
      await store.set(loginResultKey, failure, 900);
      await store.del(loginKey, "sol:sandbox:setup-lock", finalizeLockKey);
      return failure;
    }
    let log = "";
    try {
      log = await sandbox.fs.readFile("/tmp/sol-login.log", "utf8");
    } catch {
      // The detached shell may not have created the log yet.
    }
    const parsed = parseDeviceLoginOutput(log);
    if (exitCode === null) return { state: "running", ...parsed, expiresAt: running.createdAt + 15 * 60 * 1000 };
    if (exitCode !== 0) {
      const failure: DeviceLoginStatus = { state: "failed", output: parsed.output || "Codex login failed. Start a new connection." };
      await store.set(loginResultKey, failure, 900);
      await store.del(loginKey, "sol:sandbox:setup-lock", finalizeLockKey);
      await sandbox.stop({ blocking: false }).catch(() => undefined);
      return failure;
    }
    if (!(await store.setIfAbsent(finalizeLockKey, true, 120))) {
      return { state: "finalizing", output: "Securing the authenticated Codex session." };
    }
    const auth = await sandbox.fs.readFile("/home/vercel-sandbox/.codex/auth.json", "utf8").catch(() => "");
    if (!hasUsableCodexAuth(auth)) {
      const failure: DeviceLoginStatus = { state: "failed", output: "Codex login completed without usable credentials. Start a new connection." };
      await store.set(loginResultKey, failure, 900);
      await store.del(loginKey, "sol:sandbox:setup-lock", finalizeLockKey);
      await sandbox.stop({ blocking: false }).catch(() => undefined);
      return failure;
    }
    try {
      const snapshot = await sandbox.snapshot({ expiration: 30 * 24 * 60 * 60 * 1000 });
      await store.set(baseKey, { snapshotId: snapshot.snapshotId, createdAt: Date.now(), codexVersion: process.env.SOL_CODEX_VERSION || "0.144.6" }, baseTtlSeconds);
      await store.del(loginKey, loginResultKey, "sol:sandbox:setup-lock", finalizeLockKey);
      return { state: "ready", output: "Codex account connected." };
    } catch (error) {
      console.error("CODEX_LOGIN_FINALIZE_FAILED", error instanceof Error ? error.message.slice(0, 300) : "unknown");
      const failure: DeviceLoginStatus = { state: "failed", output: "Codex credentials were accepted, but the secure session could not be finalized. Start a new connection." };
      await store.set(loginResultKey, failure, 900);
      await store.del(loginKey, "sol:sandbox:setup-lock", finalizeLockKey);
      await sandbox.stop({ blocking: false }).catch(() => undefined);
      return failure;
    }
  } catch (error) {
    console.error("CODEX_LOGIN_POLL_FAILED", error instanceof Error ? error.message.slice(0, 300) : "unknown");
    const failure: DeviceLoginStatus = { state: "failed", output: "Codex login session is unavailable. Start a new connection." };
    await store.set(loginResultKey, failure, 900);
    await store.del(loginKey, "sol:sandbox:setup-lock", finalizeLockKey);
    return failure;
  } finally {
    await store.del(pollLockKey);
  }
}

export async function startReview(id: string, store: Store = getStore()): Promise<void> {
  const approved = await transitionJob(id, ["AWAITING_APPROVAL"], "APPROVED", { approvedAt: Date.now() }, store);
  if (config.mockSandbox) {
    const [policy, schema, worker] = await Promise.all([asset("review-policy.md"), asset("review-schema.json"), asset("worker.mjs")]);
    const running = await transitionJob(id, ["APPROVED"], "RUNNING", {
      startedAt: Date.now(), sandboxCommandId: "mock-review", model: config.model, reasoning: config.reasoning, codexVersion: "mock",
      protocolVersion: config.protocolVersion, policyHash: sha256(policy), schemaHash: sha256(schema), workerHash: sha256(worker),
    }, store);
    await appendJobEvents(id, [{ id: "system:protocol", at: running.startedAt || running.updatedAt, source: "system", level: "info", title: "Review protocol locked", message: `${config.protocolVersion} / policy ${running.policyHash?.slice(0, 10)} / schema ${running.schemaHash?.slice(0, 10)} / worker ${running.workerHash?.slice(0, 10)}` }], store, jobTtl(running));
    return;
  }
  const base = await store.get<SandboxBase>(baseKey);
  if (!baseIsCurrent(base)) {
    await saveTerminalResult(id, OPAQUE_OUTPUT, "Codex is not connected.", true, "AUTH_UNAVAILABLE", store);
    return;
  }
  let sandbox: Sandbox | null = null;
  try {
    sandbox = await Sandbox.create({ source: { type: "snapshot", snapshotId: base.snapshotId }, timeout: 10 * 60 * 1000 });
    const [packet, policy, schema, worker] = await Promise.all([readPacket(approved, store), asset("review-policy.md"), asset("review-schema.json"), asset("worker.mjs")]);
    await writeRuntimeAssets(sandbox);
    await sandbox.fs.writeFile("/tmp/sol-review-packet.md", packet, { encoding: "utf8" });
    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["/opt/solgate/worker.mjs", "/tmp/sol-review-packet.md"],
      env: {
        SOL_MODEL: config.model,
        SOL_REASONING: config.reasoning,
        SOL_GATE_POLICY_BASE64: policy.toString("base64"),
      },
      detached: true,
    });
    const running = await transitionJob(id, ["APPROVED"], "RUNNING", {
      startedAt: Date.now(),
      sandboxCommandId: `${sandbox.sandboxId}:${command.cmdId}`,
      model: config.model,
      reasoning: config.reasoning,
      codexVersion: base.codexVersion,
      protocolVersion: config.protocolVersion,
      policyHash: sha256(policy),
      schemaHash: sha256(schema),
      workerHash: sha256(worker),
    }, store);
    await appendJobEvents(id, [{
      id: "system:protocol",
      at: running.startedAt || running.updatedAt,
      source: "system",
      level: "info",
      title: "Review protocol locked",
      message: `${config.protocolVersion} / policy ${running.policyHash?.slice(0, 10)} / schema ${running.schemaHash?.slice(0, 10)} / worker ${running.workerHash?.slice(0, 10)}`,
    }], store, jobTtl(running));
  } catch (error) {
    if (sandbox) await sandbox.stop({ blocking: false }).catch(() => undefined);
    await appendJobEvents(id, [{ id: "error:start", at: Date.now(), source: "error", level: "error", title: "Review could not start", message: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown start failure." }], store).catch(() => undefined);
    await saveTerminalResult(id, OPAQUE_OUTPUT, "Remote review could not start.", true, "START_FAILED", store);
  }
}

async function finishMock(id: string, store: Store): Promise<void> {
  const mode = process.env.SOL_MOCK_REVIEW_MODE || "review";
  const raw = mode === "opaque"
    ? JSON.stringify({ kind: "opaque", verdict: "OPAQUE", assessment: "", recommendations: [], confidence: "LOW", evidenceCited: [], counterargument: "", withheldReason: "Mock review was withheld." })
    : JSON.stringify({ kind: "review", verdict: "SOUND", assessment: "The decision is supported by the transferred evidence.", recommendations: [], confidence: "HIGH", evidenceCited: ["S1"], counterargument: "The fixture does not exercise a real model.", withheldReason: "" });
  const output = filterInternalReview(raw);
  await saveTerminalResult(id, output, raw, output === OPAQUE_OUTPUT, "MOCK", store);
}

export async function pollReview(id: string, store: Store = getStore()): Promise<void> {
  const job = await adminGetJob(id, store);
  if (!job || job.state !== "RUNNING") return;
  const lockKey = `sol:job:${id}:poll-lock`;
  if (!(await store.setIfAbsent(lockKey, true, 15))) return;
  try {
    if (config.mockSandbox) {
      await finishMock(id, store);
      return;
    }
    const [sandboxId, commandId] = (job.sandboxCommandId || "").split(":");
    if (!sandboxId || !commandId) throw new Error("MISSING_COMMAND");
    const sandbox = await Sandbox.get({ sandboxId });
    const live = await persistLiveReview(job, sandbox, store);
    const command = await sandbox.getCommand(commandId);
    let resultBuffer: Buffer | null = null;
    try {
      resultBuffer = await sandbox.fs.readFile("/tmp/sol-review-result.json");
    } catch {
      if (command.exitCode === null) return;
      throw new Error(`WORKER_EXIT_${command.exitCode}`);
    }
    const envelope = JSON.parse(resultBuffer.toString("utf8")) as WorkerEnvelope;
    const invalid = envelope.version !== 1 || envelope.exitCode !== 0 || envelope.toolAttempt || envelope.secretLeak || envelope.malformedEvents;
    const analysis = invalid ? null : analyzeInternalReview(envelope.candidate);
    const output = analysis?.output || OPAQUE_OUTPUT;
    const completed = await saveTerminalResult(id, output, envelope.candidate || envelope.diagnostics, invalid || !analysis?.released, invalid ? "WORKER_REJECTED" : analysis?.code || "GATE_INVALID_SCHEMA", store);
    if (live) await saveLiveLog(id, live, jobTtl(completed), store);
    await sandbox.stop({ blocking: false });
  } catch (error) {
    await appendJobEvents(id, [{ id: "error:poll", at: Date.now(), source: "error", level: "error", title: "Review became unavailable", message: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown polling failure." }], store).catch(() => undefined);
    await saveTerminalResult(id, OPAQUE_OUTPUT, "Remote review became unavailable.", true, "POLL_FAILED", store);
  } finally {
    await store.del(lockKey);
  }
}

export async function readLiveReview(id: string, store: Store = getStore()): Promise<string | null> {
  const job = await adminGetJob(id, store);
  if (!job) return null;
  if (job.state !== "RUNNING" || config.mockSandbox) return adminLiveLog(id, store);
  try {
    const [sandboxId] = (job.sandboxCommandId || "").split(":");
    if (!sandboxId) return adminLiveLog(id, store);
    const sandbox = await Sandbox.get({ sandboxId });
    return (await persistLiveReview(job, sandbox, store)) || await adminLiveLog(id, store);
  } catch {
    return adminLiveLog(id, store);
  }
}

export async function deleteSandboxBase(store: Store = getStore()): Promise<void> {
  const base = await store.get<SandboxBase>(baseKey);
  if (base && !config.mockSandbox) {
    try {
      const snapshot = await Snapshot.get({ snapshotId: base.snapshotId });
      await snapshot.delete();
    } catch {
      // Base metadata is removed even if the provider object has already expired.
    }
  }
  await store.del(baseKey, loginKey, loginResultKey, "sol:sandbox:setup-lock", finalizeLockKey, pollLockKey);
}
