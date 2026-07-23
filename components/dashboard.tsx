"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Check,
  Clipboard,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  HardDrive,
  KeyRound,
  Link2,
  ListTree,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  WifiOff,
  X,
} from "lucide-react";

interface Health {
  ok: boolean;
  paired: boolean;
  codexConnected: boolean;
  mode?: string;
}

interface Job {
  id: string;
  packetHash: string;
  compressedBytes: number;
  state: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  approvedAt?: number;
  startedAt?: number;
  completedAt?: number;
  model?: string;
  reasoning?: string;
  internalCode?: string;
  codexVersion?: string;
  protocolVersion?: string;
  policyHash?: string;
  schemaHash?: string;
  workerHash?: string;
}

interface ReviewEvent {
  id: string;
  at: number;
  source: "system" | "codex" | "usage" | "gate" | "error" | "result";
  level: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
  };
}

interface JobDetail {
  job: Job;
  preview: string | null;
  packetTruncated: boolean;
  packetQuality: {
    score: number;
    bytes: number;
    sectionsPresent: number;
    sectionsRequired: number;
    sourceIds: number;
    sourceReferences: number;
    issues: string[];
  } | null;
  raw: string | null;
  result: string | null;
  live: string | null;
}

interface StorageSummary {
  retentionDays: number;
  jobs: number;
  packetBytes: number;
  eventBytes: number;
  rawBytes: number;
  totalBytes: number;
}

interface CodexLogin {
  state: "idle" | "running" | "finalizing" | "ready" | "failed";
  output?: string;
  deviceUrl?: string;
  userCode?: string;
  expiresAt?: number;
}

const DB_NAME = "sol-gate-device";
const STORE_NAME = "credentials";
const terminalStates = new Set(["COMPLETE_REVIEW", "COMPLETE_OPAQUE", "REJECTED", "EXPIRED"]);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function bytesToBase64Url(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hexDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const [privateKey, credentialId] = await Promise.all([dbGet<CryptoKey>("privateKey"), dbGet<string>("credentialId")]);
  if (!privateKey || !credentialId) throw new Error("This phone is not paired.");
  const challengeResponse = await fetch("/api/admin/challenge", { method: "POST", cache: "no-store" });
  if (!challengeResponse.ok) throw new Error("Approval service is unavailable.");
  const challenge = (await challengeResponse.json()) as { nonce: string };
  const method = (init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  const timestamp = String(Date.now());
  const payload = [method, path, timestamp, challenge.nonce, await hexDigest(body)].join("\n");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(payload));
  const headers = new Headers(init.headers);
  headers.set("x-sol-credential", credentialId);
  headers.set("x-sol-timestamp", timestamp);
  headers.set("x-sol-nonce", challenge.nonce);
  headers.set("x-sol-signature", bytesToBase64Url(signature));
  if (body) headers.set("content-type", "application/json");
  return fetch(path, { ...init, headers, cache: "no-store" });
}

function stateLabel(state: string): string {
  if (state === "COMPLETE_OPAQUE") return "Not released";
  return state.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function outcomeLabel(code?: string): string {
  const labels: Record<string, string> = {
    RELEASED: "Released",
    MODEL_WITHHELD: "Model withheld",
    GATE_REFUSAL_LANGUAGE: "Blocked: refusal language",
    GATE_SECRET: "Blocked: protected data",
    GATE_INVALID_SCHEMA: "Blocked: invalid format",
    GATE_EMPTY: "Blocked: empty response",
    GATE_OVERSIZE: "Blocked: oversized response",
    WORKER_REJECTED: "Worker rejected",
    START_FAILED: "Start failure",
    POLL_FAILED: "Runtime failure",
    AUTH_UNAVAILABLE: "Authentication unavailable",
    FILTERED: "Legacy unclassified",
    MOCK: "Mock run",
  };
  return code ? labels[code] || code.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Pending";
}

function formatBytes(value = 0): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function formatDuration(start?: number, end?: number): string {
  if (!start) return "Not started";
  const seconds = Math.max(0, Math.round(((end || Date.now()) - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function sourceLabel(source: ReviewEvent["source"]): string {
  const labels: Record<ReviewEvent["source"], string> = {
    system: "System",
    codex: "Codex",
    usage: "Usage",
    gate: "Release check",
    error: "Error",
    result: "Result",
  };
  return labels[source];
}

function readableEventTitle(title: string): string {
  if (title === "Opaque result released" || title === "Complete Opaque") return "Review was not released";
  return title;
}

function readableValue(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try { return readableValue(JSON.parse(text), depth + 1) || text; } catch { return text; }
    }
    return text;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => readableValue(item, depth + 1)).filter(Boolean).join("\n");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "review") {
      const verdict = readableValue(record.verdict, depth + 1);
      const confidence = readableValue(record.confidence, depth + 1);
      const assessment = readableValue(record.assessment, depth + 1);
      const evidence = Array.isArray(record.evidenceCited) ? record.evidenceCited.map((item) => readableValue(item, depth + 1)).filter(Boolean) : [];
      const counterargument = readableValue(record.counterargument, depth + 1);
      const recommendations = Array.isArray(record.recommendations) ? record.recommendations.map((item) => readableValue(item, depth + 1)).filter(Boolean) : [];
      return [verdict ? `Verdict: ${verdict}` : "", confidence ? `Confidence: ${confidence}` : "", assessment, evidence.length ? `Evidence cited:\n${evidence.map((item) => `- ${item}`).join("\n")}` : "", counterargument ? `Counterargument:\n${counterargument}` : "", recommendations.length ? `Recommendations:\n${recommendations.map((item) => `- ${item}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
    }
    if (record.kind === "opaque") return readableValue(record.withheldReason ?? record.assessment, depth + 1) || "Codex returned no substantive review for release.";
    const primary = record.message ?? record.text ?? record.summary ?? record.error ?? record.content;
    const message = readableValue(primary, depth + 1);
    const code = typeof record.code === "string" ? record.code : "";
    if (message) return `${message}${code && !message.includes(code) ? `\nTechnical code: ${code}` : ""}`;
    return Object.entries(record)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => `${key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())}: ${item}`)
      .join("\n");
  }
  return "";
}

interface ReadableResult {
  verdict: string;
  assessment: string;
  recommendations: string[];
  released: boolean;
  confidence?: string;
  evidence?: string[];
  counterargument?: string;
}

function resultSection(value: string, label: string, following: string[]): string {
  const start = value.indexOf(`${label}:`);
  if (start < 0) return "";
  const contentStart = start + label.length + 1;
  const ends = following.map((next) => value.indexOf(`\n${next}:`, contentStart)).filter((index) => index >= 0);
  return value.slice(contentStart, ends.length ? Math.min(...ends) : value.length).trim();
}

function parseResult(value: string | null): ReadableResult | null {
  if (!value) return null;
  if (value.trim() === "Bob Regress") return { verdict: "Not released", assessment: "No substantive review was released.", recommendations: [], released: false };
  const verdict = resultSection(value, "VERDICT", ["CONFIDENCE", "ASSESSMENT", "EVIDENCE CITED", "COUNTERARGUMENT", "RECOMMENDATIONS"]);
  const assessment = resultSection(value, "ASSESSMENT", ["EVIDENCE CITED", "COUNTERARGUMENT", "RECOMMENDATIONS"]);
  if (!verdict || !assessment) return { verdict: "Review", assessment: readableValue(value), recommendations: [], released: true };
  const evidence = resultSection(value, "EVIDENCE CITED", ["COUNTERARGUMENT", "RECOMMENDATIONS"]);
  const recommendations = resultSection(value, "RECOMMENDATIONS", []);
  return {
    verdict: verdict.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    confidence: resultSection(value, "CONFIDENCE", ["ASSESSMENT", "EVIDENCE CITED", "COUNTERARGUMENT", "RECOMMENDATIONS"]),
    assessment,
    evidence: evidence.split("\n").map((item) => item.replace(/^\s*-\s*/, "").trim()).filter((item) => item && item !== "None"),
    counterargument: resultSection(value, "COUNTERARGUMENT", ["RECOMMENDATIONS"]),
    recommendations: recommendations.split("\n").map((item) => item.replace(/^\s*-\s*/, "").trim()).filter((item) => item && item !== "None"),
    released: true,
  };
}

function parseCodexResponse(value: string | null): ReadableResult | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.kind === "review") {
      const verdict = typeof parsed.verdict === "string" ? parsed.verdict : "Codex response";
      return {
        verdict: verdict.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        confidence: readableValue(parsed.confidence),
        assessment: readableValue(parsed.assessment) || "Codex returned a review without an assessment.",
        evidence: Array.isArray(parsed.evidenceCited) ? parsed.evidenceCited.map((item) => readableValue(item)).filter(Boolean) : [],
        counterargument: readableValue(parsed.counterargument),
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map((item) => readableValue(item)).filter(Boolean) : [],
        released: false,
      };
    }
    if (parsed.kind === "opaque") return { verdict: "No review", assessment: readableValue(parsed.withheldReason ?? parsed.assessment) || "Codex returned no substantive review.", recommendations: [], released: false };
  } catch {
    // Provider diagnostics and malformed candidates are still useful as plain text.
  }
  return { verdict: "Codex response", assessment: readableValue(value), recommendations: [], released: false };
}

function ResultCard({ result, phoneOnly = false }: { result: ReadableResult; phoneOnly?: boolean }) {
  return <article className={`readable-result ${result.released ? "released" : "not-released"}`}>
    {phoneOnly && <div className="phone-only-label"><LockKeyhole size={14} /><span>Phone only. This is never sent to Claude.</span></div>}
    <div className="result-verdict"><div><span>Verdict</span><strong>{result.verdict}</strong></div>{result.confidence && <div><span>Confidence</span><strong>{result.confidence}</strong></div>}</div>
    <div className="result-assessment"><h3>{phoneOnly ? "What Codex said" : "Assessment"}</h3><p>{result.assessment}</p></div>
    {result.evidence && result.evidence.length > 0 && <div className="result-evidence"><h3>Evidence cited</h3><div>{result.evidence.map((item) => <code key={item}>{item}</code>)}</div></div>}
    {result.counterargument && <div className="result-counterargument"><h3>Strongest counterargument</h3><p>{result.counterargument}</p></div>}
    {result.recommendations.length > 0 && <div className="result-recommendations"><h3>Recommendations</h3><ol>{result.recommendations.map((recommendation, index) => <li key={`${index}:${recommendation}`}>{recommendation}</li>)}</ol></div>}
  </article>;
}

export function Dashboard({ initialView }: { initialView: "reviews" | "storage" | "lab" }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [hasDeviceKey, setHasDeviceKey] = useState(false);
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const eventCursor = useRef(0);
  const [detailTab, setDetailTab] = useState<"live" | "packet" | "result" | "raw">("live");
  const mainView = initialView;
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [codexLogin, setCodexLogin] = useState<CodexLogin | null>(null);
  const [clientToken, setClientToken] = useState("");
  const [busy, setBusy] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [serviceOrigin, setServiceOrigin] = useState("");
  const detailPanelRef = useRef<HTMLDivElement>(null);

  const loadHealth = useCallback(async () => {
    const response = await fetch("/api/health", { cache: "no-store" });
    setHealth((await response.json()) as Health);
    setHasDeviceKey(Boolean(await dbGet<CryptoKey>("privateKey")));
  }, []);

  const loadJobs = useCallback(async () => {
    if (!hasDeviceKey) return;
    try {
      const response = await signedFetch("/api/admin/jobs");
      if (!response.ok) throw new Error("Phone authorization failed.");
      const data = (await response.json()) as { jobs: Job[] };
      setJobs(data.jobs);
      setSelectedId((current) => current && data.jobs.some((job) => job.id === current) ? current : data.jobs[0]?.id || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh reviews.");
    } finally {
      setJobsLoaded(true);
    }
  }, [hasDeviceKey]);

  const loadStorage = useCallback(async () => {
    if (!hasDeviceKey) return;
    try {
      const response = await signedFetch("/api/admin/storage");
      if (!response.ok) throw new Error("Storage summary is unavailable.");
      setStorage((await response.json()) as StorageSummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load storage.");
    } finally {
      setStorageLoaded(true);
    }
  }, [hasDeviceKey]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const path = `/api/admin/jobs/${id}`;
      const response = await signedFetch(path);
      if (!response.ok) throw new Error("Review is unavailable.");
      setDetail((await response.json()) as JobDetail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load review.");
    }
  }, []);

  const loadEvents = useCallback(async (id: string, reset = false) => {
    try {
      const cursor = reset ? 0 : eventCursor.current;
      const path = `/api/admin/jobs/${id}/events?cursor=${cursor}`;
      const response = await signedFetch(path);
      if (!response.ok) throw new Error("Live review activity is unavailable.");
      const data = (await response.json()) as { events: ReviewEvent[]; cursor: number };
      eventCursor.current = data.cursor;
      setEvents((current) => reset ? data.events : [...new Map([...current, ...data.events].map((event) => [event.id, event])).values()].sort((left, right) => left.at - right.at));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load live activity.");
    }
  }, []);

  useEffect(() => {
    setServiceOrigin(window.location.origin);
    setOnline(navigator.onLine);
    const setConnected = () => setOnline(true);
    const setDisconnected = () => setOnline(false);
    window.addEventListener("online", setConnected);
    window.addEventListener("offline", setDisconnected);
    void loadHealth();
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => registration.update());
    return () => {
      window.removeEventListener("online", setConnected);
      window.removeEventListener("offline", setDisconnected);
    };
  }, [loadHealth]);

  useEffect(() => {
    if (!hasDeviceKey) return;
    void Promise.all([loadJobs(), loadStorage()]);
    const timer = window.setInterval(() => void loadJobs(), 8_000);
    return () => window.clearInterval(timer);
  }, [hasDeviceKey, loadJobs, loadStorage]);

  useEffect(() => {
    if (!selectedId || !hasDeviceKey) return;
    setDetail(null);
    setEvents([]);
    setDetailLoading(true);
    eventCursor.current = 0;
    void Promise.all([loadDetail(selectedId), loadEvents(selectedId, true)]).finally(() => setDetailLoading(false));
  }, [hasDeviceKey, loadDetail, loadEvents, selectedId]);

  const selectedActive = Boolean(detail && !terminalStates.has(detail.job.state));
  useEffect(() => {
    if (!selectedId || !selectedActive) return;
    const timer = window.setInterval(() => void Promise.all([loadEvents(selectedId), loadDetail(selectedId), loadJobs()]), 2_000);
    return () => window.clearInterval(timer);
  }, [loadDetail, loadEvents, loadJobs, selectedActive, selectedId]);

  const pair = async () => {
    setBusy("pair"); setError("");
    try {
      const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
      const response = await fetch("/api/admin/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: bootstrapSecret, publicKey }) });
      const data = (await response.json()) as { credentialId?: string; error?: string };
      if (!response.ok || !data.credentialId) {
        const messages: Record<string, string> = {
          already_paired: "This deployment is already paired in another browser.",
          invalid_secret: "The bootstrap secret does not match. Paste it again without quotes.",
          invalid_key: "This browser could not create a compatible approval key.",
        };
        throw new Error(messages[data.error || ""] || "Pairing was rejected.");
      }
      await Promise.all([dbSet("privateKey", keys.privateKey), dbSet("credentialId", data.credentialId)]);
      setHasDeviceKey(true); setBootstrapSecret("");
      await loadHealth();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pairing failed.");
    } finally { setBusy(""); }
  };

  const decision = async (value: "approve" | "reject") => {
    if (!selectedId) return;
    setBusy(value); setError("");
    try {
      const path = `/api/admin/jobs/${selectedId}/decision`;
      const response = await signedFetch(path, { method: "POST", body: JSON.stringify({ decision: value }) });
      if (!response.ok) throw new Error("Decision was not accepted.");
      await Promise.all([loadJobs(), loadDetail(selectedId), loadEvents(selectedId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Decision failed.");
    } finally { setBusy(""); }
  };

  const removeJob = async (id: string) => {
    if (deleteConfirm !== id) { setDeleteConfirm(id); return; }
    setBusy(`delete:${id}`); setError("");
    try {
      const path = `/api/admin/jobs/${id}`;
      const response = await signedFetch(path, { method: "DELETE" });
      if (!response.ok) throw new Error("Review could not be deleted.");
      setDeleteConfirm(null);
      if (selectedId === id) { setSelectedId(null); setDetail(null); setEvents([]); }
      await Promise.all([loadJobs(), loadStorage()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deletion failed.");
    } finally { setBusy(""); }
  };

  const selectJob = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 760px)").matches) {
      window.requestAnimationFrame(() => detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const updateRetention = async (days: number) => {
    setBusy("retention"); setError("");
    try {
      const response = await signedFetch("/api/admin/storage", { method: "POST", body: JSON.stringify({ retentionDays: days }) });
      if (!response.ok) throw new Error("Retention could not be updated.");
      setStorage((await response.json()) as StorageSummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Retention update failed.");
    } finally { setBusy(""); }
  };

  const loadCodexLogin = useCallback(async () => {
    try {
      const response = await signedFetch("/api/admin/codex/login");
      if (!response.ok) throw new Error("Codex connection status is unavailable.");
      const status = (await response.json()) as CodexLogin;
      setCodexLogin(status);
      setBusy(status.state === "running" || status.state === "finalizing" ? "codex" : "");
      if (status.state === "ready") await loadHealth();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Codex connection failed.");
      setBusy("");
    }
  }, [loadHealth]);

  useEffect(() => {
    if (!hasDeviceKey || health?.codexConnected) return;
    void loadCodexLogin();
  }, [hasDeviceKey, health?.codexConnected, loadCodexLogin]);

  useEffect(() => {
    if (codexLogin?.state !== "running" && codexLogin?.state !== "finalizing") return;
    const timer = window.setInterval(() => void loadCodexLogin(), 2_000);
    return () => window.clearInterval(timer);
  }, [codexLogin?.state, loadCodexLogin]);

  const connectCodex = async () => {
    setBusy("codex"); setError("");
    try {
      const response = await signedFetch("/api/admin/codex/login", { method: "POST", body: "{}" });
      if (!response.ok) throw new Error("Codex connection could not start.");
      await loadCodexLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Codex connection failed.");
      setBusy("");
    }
  };

  const addClient = async () => {
    setBusy("client"); setError("");
    try {
      const response = await signedFetch("/api/admin/clients", { method: "POST", body: JSON.stringify({ name: "Claude Code" }) });
      if (!response.ok) throw new Error("Client enrollment failed.");
      setClientToken(((await response.json()) as { token: string }).token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Client enrollment failed.");
    } finally { setBusy(""); }
  };

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const query = search.trim().toLowerCase();
    return (stateFilter === "ALL" || job.state === stateFilter) && (!query || `${job.id} ${job.state} ${job.model || ""}`.toLowerCase().includes(query));
  }), [jobs, search, stateFilter]);
  const pending = jobs.filter((job) => job.state === "AWAITING_APPROVAL").length;
  const usage = events.reduce((totals, event) => ({
    input: totals.input + (event.usage?.inputTokens || 0),
    output: totals.output + (event.usage?.outputTokens || 0),
    reasoning: totals.reasoning + (event.usage?.reasoningOutputTokens || 0),
  }), { input: 0, output: 0, reasoning: 0 });
  const readableResult = parseResult(detail?.result || null);
  const privateCodexResponse = detail?.result === "Bob Regress" ? parseCodexResponse(detail.raw) : null;
  const lastEvent = events.length ? events[events.length - 1] : undefined;
  const completedRuns = jobs.filter((job) => job.state === "COMPLETE_REVIEW" || job.state === "COMPLETE_OPAQUE");
  const releasedRuns = completedRuns.filter((job) => job.internalCode === "RELEASED" || job.state === "COMPLETE_REVIEW").length;
  const modelWithheldRuns = completedRuns.filter((job) => job.internalCode === "MODEL_WITHHELD").length;
  const wrapperBlockedRuns = completedRuns.filter((job) => job.internalCode?.startsWith("GATE_")).length;
  const systemFailureRuns = completedRuns.filter((job) => ["WORKER_REJECTED", "START_FAILED", "POLL_FAILED", "AUTH_UNAVAILABLE"].includes(job.internalCode || "")).length;
  const unclassifiedRuns = Math.max(0, completedRuns.length - releasedRuns - modelWithheldRuns - wrapperBlockedRuns - systemFailureRuns);
  const releaseRate = completedRuns.length ? Math.round((releasedRuns / completedRuns.length) * 100) : 0;
  const protocolVersions = [...new Set(completedRuns.map((job) => job.protocolVersion).filter(Boolean))];
  const windowsInstaller = `$env:SOL_GATE_URL='${serviceOrigin}'; irm 'https://raw.githubusercontent.com/cabibbz/SolReviewGate/main/install.ps1' | iex`;

  if (!health) return <main className="empty"><LoaderCircle className="spin" aria-label="Loading" /></main>;

  if (health.paired && !hasDeviceKey) return <main className="content setup"><section className="panel"><div className="panel-body"><h1 className="setup-title"><TriangleAlert size={22} /> Paired in another browser</h1><p className="section-copy">Open the original paired PWA. This browser does not hold the non-exportable approval key.</p><button className="btn" type="button" onClick={() => void loadHealth()}><RefreshCw size={16} /> Check again</button></div></section></main>;

  if (!health.paired || !hasDeviceKey) return <main className="content setup"><section className="panel"><div className="panel-body"><Image className="setup-logo" src="/brandmark.png" alt="" width={64} height={64} priority /><h1 className="setup-title"><LockKeyhole size={22} /> Pair this phone</h1><p className="section-copy">Add Sol Gate to the Home Screen first, open the installed app, then enter the bootstrap secret.</p><div className="field"><label htmlFor="bootstrap">Bootstrap secret</label><input id="bootstrap" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} /></div>{error && <p className="notice error">{error}</p>}<button className="btn primary" type="button" disabled={!bootstrapSecret || busy === "pair"} onClick={() => void pair()}>{busy === "pair" ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} Pair phone</button></div></section></main>;

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Image src="/brandmark.png" alt="" width={38} height={38} priority /></span><div><h1>Sol Gate</h1><p>Private review control plane</p></div></div>
      <span className="status-pill">{online ? <span className={`status-dot ${health.ok ? "ok" : "warn"}`} /> : <WifiOff size={13} />}{online ? (health.ok ? "Online" : "Attention") : "Offline"}</span>
    </header>

    <div className="content">
      <section className="metrics" aria-label="System status">
        <div className="metric"><span className="metric-label">Codex</span><span className="metric-value"><Link2 size={16} />{health.codexConnected ? "Connected" : "Not connected"}</span></div>
        <div className="metric"><span className="metric-label">Pending</span><span className="metric-value"><Activity size={16} />{pending}</span></div>
        <div className="metric"><span className="metric-label">History</span><span className="metric-value"><ListTree size={16} />{jobs.length}</span></div>
        <div className="metric"><span className="metric-label">Storage</span><span className="metric-value"><HardDrive size={16} />{formatBytes(storage?.totalBytes)}</span></div>
      </section>

      <div className="toolbar dashboard-actions">
        <button className="btn icon" type="button" onClick={() => void Promise.all([loadJobs(), loadStorage(), selectedId ? loadDetail(selectedId) : Promise.resolve()])} title="Refresh" aria-label="Refresh"><RefreshCw size={16} /></button>
        {!health.codexConnected && codexLogin?.state !== "running" && codexLogin?.state !== "finalizing" && <button className="btn primary" type="button" onClick={() => void connectCodex()} disabled={busy === "codex"}><Link2 size={16} /> Connect Codex</button>}
        <button className="btn" type="button" onClick={() => void addClient()} disabled={busy === "client"}><Plus size={16} /> Add Claude client</button>
      </div>

      {error && <p className="notice error">{error}</p>}
      {codexLogin?.state === "running" && codexLogin.deviceUrl && codexLogin.userCode && <section className="device-login" aria-label="Codex device login"><div className="device-login-heading"><div><span className="metric-label">Codex account</span><h2>Complete device sign-in</h2></div><span className="status-pill"><LoaderCircle className="spin" size={13} /> Waiting</span></div><div className="device-steps"><div className="device-step"><span className="step-number">1</span><div><strong>Open secure sign-in</strong><div className="device-actions"><a className="btn primary" href={codexLogin.deviceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open OpenAI sign-in</a><button className="btn icon" title="Copy sign-in link" aria-label="Copy sign-in link" onClick={() => void navigator.clipboard.writeText(codexLogin.deviceUrl || "")}><Clipboard size={16} /></button></div></div></div><div className="device-step"><span className="step-number">2</span><div><strong>Enter one-time code</strong><div className="device-code-row"><code className="device-code">{codexLogin.userCode}</code><button className="btn icon" title="Copy code" aria-label="Copy code" onClick={() => void navigator.clipboard.writeText(codexLogin.userCode || "")}><Clipboard size={16} /></button></div></div></div></div></section>}
      {codexLogin?.state === "finalizing" && <p className="notice"><LoaderCircle className="spin" size={14} /> Securing the authenticated Codex session.</p>}
      {codexLogin?.state === "failed" && <p className="notice error">{codexLogin.output || "Codex connection failed."}</p>}
      {clientToken && <section className="client-setup" aria-label="Claude Code client setup">
        <div className="client-setup-heading"><div><span className="metric-label">Claude Code</span><h2>Install the review skill</h2></div><span className="status-pill"><KeyRound size={13} /> Token shown once</span></div>
        <div className="client-setup-body">
          <div className="client-setup-step"><span className="step-number">1</span><div><strong>Copy the client token</strong><p>The installer asks for this value privately in the computer terminal.</p><div className="token-box"><input readOnly value={clientToken} aria-label="Client token" /><button className="btn icon" title="Copy token" aria-label="Copy token" onClick={() => void navigator.clipboard.writeText(clientToken)}><Clipboard size={16} /></button></div></div></div>
          <div className="client-setup-step"><span className="step-number">2</span><div><strong>Run the Windows installer</strong><p>Open PowerShell on the Claude Code computer, paste this command, then enter the token.</p><pre className="installer-command">{windowsInstaller}</pre><div className="client-setup-actions"><button className="btn primary" type="button" onClick={() => void navigator.clipboard.writeText(windowsInstaller)}><Clipboard size={16} /> Copy installer</button><a className="btn" href="https://github.com/cabibbz/SolReviewGate#install-the-claude-skill" target="_blank" rel="noreferrer"><ExternalLink size={16} /> Full instructions</a></div></div></div>
        </div>
      </section>}

      <nav className="view-tabs main-view-tabs" role="tablist" aria-label="Dashboard views">
        {/* Native navigation is intentional so view switching survives a failed mobile hydration. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a role="tab" aria-selected={mainView === "reviews"} className={mainView === "reviews" ? "active" : ""} href="/?view=reviews"><ListTree size={16} /> Reviews</a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a role="tab" aria-selected={mainView === "storage"} className={mainView === "storage" ? "active" : ""} href="/?view=storage"><Database size={16} /> Storage</a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a role="tab" aria-selected={mainView === "lab"} className={mainView === "lab" ? "active" : ""} href="/?view=lab"><Activity size={16} /> Lab</a>
      </nav>

      <div className="main-view-content">{mainView === "reviews" ? (!jobsLoaded ? <section className="panel loading-panel"><LoaderCircle className="spin" size={26} /><strong>Loading reviews</strong></section> : jobs.length === 0 ? <section className="panel no-reviews-panel"><FileText size={28} /><h2>No reviews stored</h2><p>The next review submitted with <code>/sol</code> will appear here.</p></section> : <section className="workspace">
        <div className="panel history-panel">
          <div className="panel-header"><h2>Review history</h2><span className="status-pill">{filteredJobs.length}</span></div>
          <div className="history-filters"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reviews" aria-label="Search reviews" /></label><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filter review state"><option value="ALL">All states</option><option value="AWAITING_APPROVAL">Pending approval</option><option value="RUNNING">Running</option><option value="COMPLETE_REVIEW">Complete review</option><option value="COMPLETE_OPAQUE">Not released</option><option value="REJECTED">Rejected</option></select></div>
          {filteredJobs.length ? <ul className="job-list">{filteredJobs.map((job) => <li key={job.id}><button className={`job-button ${selectedId === job.id ? "active" : ""}`} onClick={() => selectJob(job.id)}><span className="job-row"><span className="job-id">{job.id}</span><span className={`state-badge state-${job.state.toLowerCase()}`}>{stateLabel(job.state)}</span></span><span className="job-meta">{new Date(job.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {formatBytes(job.compressedBytes)}</span></button></li>)}</ul> : <div className="empty compact"><div><Check size={26} /><p>No matching reviews.</p></div></div>}
        </div>

        <div className="panel detail-panel" ref={detailPanelRef}>
          <div className="panel-header"><h2>Review detail</h2>{detail && <div className="header-actions"><span className={`state-badge state-${detail.job.state.toLowerCase()}`}>{stateLabel(detail.job.state)}</span>{terminalStates.has(detail.job.state) && <button className={`btn icon ${deleteConfirm === detail.job.id ? "danger" : ""}`} title={deleteConfirm === detail.job.id ? "Confirm delete" : "Delete review"} aria-label={deleteConfirm === detail.job.id ? "Confirm delete" : "Delete review"} onClick={() => void removeJob(detail.job.id)} disabled={busy === `delete:${detail.job.id}`}><Trash2 size={16} /></button>}</div>}</div>
          {!detail ? <div className="empty"><div>{detailLoading ? <LoaderCircle className="spin" size={30} /> : <ShieldCheck size={30} />}<p>{detailLoading ? "Loading review details." : "Choose a review from history."}</p></div></div> : <>
            <div className="review-facts"><div><span>Model</span><strong>{detail.job.model || "Pending"}</strong></div><div><span>Reasoning</span><strong>{detail.job.reasoning || "Pending"}</strong></div><div><span>Duration</span><strong>{formatDuration(detail.job.startedAt, detail.job.completedAt)}</strong></div><div><span>Tokens</span><strong>{(usage.input + usage.output).toLocaleString()}</strong></div><div><span>Outcome</span><strong>{outcomeLabel(detail.job.internalCode)}</strong></div><div><span>Protocol</span><strong>{detail.job.protocolVersion || "Legacy"}</strong></div><div><span>Expires</span><strong>{new Date(detail.job.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" })}</strong></div></div>
            {detail.job.state === "AWAITING_APPROVAL" && <div className="approval-bar">{detail.packetQuality && <span className="approval-quality">Packet {detail.packetQuality.score}/100</span>}<button className="btn primary" onClick={() => void decision("approve")} disabled={Boolean(busy)}><Check size={16} /> Approve packet</button><button className="btn danger" onClick={() => void decision("reject")} disabled={Boolean(busy)}><X size={16} /> Reject</button></div>}
            <div className="detail-tabs" role="tablist"><button className={detailTab === "live" ? "active" : ""} onClick={() => setDetailTab("live")}><Activity size={15} /> Live</button><button className={detailTab === "packet" ? "active" : ""} onClick={() => setDetailTab("packet")}><FileText size={15} /> Packet</button><button className={detailTab === "result" ? "active" : ""} onClick={() => setDetailTab("result")}><ShieldCheck size={15} /> Result</button><button className={detailTab === "raw" ? "active" : ""} onClick={() => setDetailTab("raw")}><TerminalSquare size={15} /> Raw</button></div>
            <div className="panel-body detail-content">
              {detailTab === "live" && <><div className="transcript-heading"><div><strong>{selectedActive ? "Codex is responding" : terminalStates.has(detail.job.state) ? "Response complete" : stateLabel(detail.job.state)}</strong><span>{lastEvent ? `Updated ${new Date(lastEvent.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Waiting for text"}</span></div>{selectedActive && <LoaderCircle className="spin" size={16} />}</div>{events.length ? <div className="transcript">{events.map((event) => { const message = event.title === "Codex session started" ? "" : readableValue(event.message); return <section key={event.id} className={`transcript-entry source-${event.source}`}><div className="transcript-meta"><span>{sourceLabel(event.source)}</span><time>{new Date(event.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time></div>{message ? <div className="transcript-text">{message}</div> : <div className="transcript-status">{readableEventTitle(event.title)}</div>}{event.usage && <div className="transcript-usage">Input {event.usage.inputTokens?.toLocaleString() || 0} / Cached {event.usage.cachedInputTokens?.toLocaleString() || 0} / Output {event.usage.outputTokens?.toLocaleString() || 0} / Reasoning {event.usage.reasoningOutputTokens?.toLocaleString() || 0}</div>}</section>; })}</div> : <div className="empty compact"><div>{selectedActive ? <LoaderCircle className="spin" size={24} /> : <Clock3 size={24} />}<p>{selectedActive ? "Waiting for Codex to emit text." : "No transcript was retained for this older review."}</p></div></div>}</>}
              {detailTab === "packet" && <>{detail.packetQuality && <div className="packet-quality"><div><span>Quality</span><strong>{detail.packetQuality.score}/100</strong></div><div><span>Sections</span><strong>{detail.packetQuality.sectionsPresent}/{detail.packetQuality.sectionsRequired}</strong></div><div><span>Sources</span><strong>{detail.packetQuality.sourceIds}</strong></div><div><span>Citations</span><strong>{detail.packetQuality.sourceReferences}</strong></div></div>}{detail.packetQuality && detail.packetQuality.issues.length > 0 && <ul className="quality-issues">{detail.packetQuality.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}<div className="content-heading"><span>Submitted context</span><code>{detail.job.packetHash.slice(0, 12)}</code></div><pre className="code-block packet-block">{detail.preview || "Packet unavailable."}</pre>{detail.packetTruncated && <p className="notice">Packet preview limited to 200 KB.</p>}</>}
              {detailTab === "result" && <><div className="content-heading"><span>Review result</span><code>{stateLabel(detail.job.state)}</code></div>{readableResult ? <ResultCard result={readableResult} /> : <div className="empty compact"><div>{selectedActive ? <LoaderCircle className="spin" size={24} /> : <ShieldCheck size={24} />}<p>{selectedActive ? "The review is still running." : "No substantive review was released."}</p></div></div>}{privateCodexResponse && <section className="private-codex-response"><div className="content-heading secondary"><span>Codex response that was not released</span></div><ResultCard result={privateCodexResponse} phoneOnly /></section>}{usage.input > 0 && <div className="usage-summary"><div><span>Input</span><strong>{usage.input.toLocaleString()}</strong></div><div><span>Output</span><strong>{usage.output.toLocaleString()}</strong></div><div><span>Reasoning</span><strong>{usage.reasoning.toLocaleString()}</strong></div></div>}</>}
              {detailTab === "raw" && <><div className="raw-intro"><TerminalSquare size={16} /><span>Exact technical records for troubleshooting.</span></div><div className="content-heading"><span>Codex event stream</span><code>{detail.live ? formatBytes(new Blob([detail.live]).size) : "0 B"}</code></div><pre className="code-block raw-block">{detail.live || "No Codex event stream was retained."}</pre><div className="content-heading secondary"><span>Released result</span></div><pre className="code-block raw-block">{detail.result || "No released result was retained."}</pre><div className="content-heading secondary"><span>Final Codex response before release checks</span></div><pre className="code-block raw-block">{detail.raw || "No final Codex response was retained."}</pre></>}
            </div>
          </>}
        </div>
      </section>) : mainView === "storage" ? (!storageLoaded ? <section className="panel loading-panel"><LoaderCircle className="spin" size={26} /><strong>Loading storage</strong></section> : <section className="storage-view">
        <div className="panel"><div className="panel-header"><h2>Encrypted storage</h2><span className="status-pill">{storage?.retentionDays || 0} days</span></div><div className="storage-metrics"><div><span>Retained reviews</span><strong>{storage?.jobs || 0}</strong></div><div><span>Packets</span><strong>{formatBytes(storage?.packetBytes)}</strong></div><div><span>Events</span><strong>{formatBytes(storage?.eventBytes)}</strong></div><div><span>Raw and results</span><strong>{formatBytes(storage?.rawBytes)}</strong></div><div><span>Total payload</span><strong>{formatBytes(storage?.totalBytes)}</strong></div></div><div className="retention-control"><label htmlFor="retention">Retention</label><select id="retention" value={storage?.retentionDays || 7} disabled={busy === "retention"} onChange={(event) => void updateRetention(Number(event.target.value))}><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></div></div>
        <div className="panel"><div className="panel-header"><h2>Retained reviews</h2><span className="status-pill">{jobs.length}</span></div>{jobs.length ? <div className="storage-list">{jobs.map((job) => <div className="storage-row" key={job.id}><div><strong>{stateLabel(job.state)}</strong><span>{new Date(job.createdAt).toLocaleString()} · {formatBytes(job.compressedBytes)}</span><code>{job.id}</code></div>{terminalStates.has(job.state) && <button className={`btn icon ${deleteConfirm === job.id ? "danger" : ""}`} title={deleteConfirm === job.id ? "Confirm delete" : "Delete review"} aria-label={deleteConfirm === job.id ? "Confirm delete" : "Delete review"} onClick={() => void removeJob(job.id)}><Trash2 size={16} /></button>}</div>)}</div> : <div className="empty compact"><div><Database size={25} /><p>No retained reviews.</p></div></div>}</div>
      </section>) : <section className="lab-view">
        <div className="panel"><div className="panel-header"><h2>Alignment outcomes</h2><span className="status-pill">{completedRuns.length} runs</span></div><div className="lab-metrics"><div><span>Release rate</span><strong>{releaseRate}%</strong></div><div><span>Released</span><strong>{releasedRuns}</strong></div><div><span>Model withheld</span><strong>{modelWithheldRuns}</strong></div><div><span>Wrapper blocked</span><strong>{wrapperBlockedRuns}</strong></div><div><span>System failure</span><strong>{systemFailureRuns}</strong></div><div><span>Unclassified</span><strong>{unclassifiedRuns}</strong></div></div></div>
        <div className="panel"><div className="panel-header"><h2>Protocol identity</h2><span className="status-pill">{protocolVersions.length || 0} versions</span></div><div className="protocol-list">{protocolVersions.length ? protocolVersions.map((version) => <div key={version}><strong>{version}</strong><span>{completedRuns.filter((job) => job.protocolVersion === version).length} runs</span></div>) : <div><strong>Legacy records</strong><span>No fingerprinted run has completed yet.</span></div>}</div></div>
        <div className="panel"><div className="panel-header"><h2>Recent classifications</h2><span className="status-pill">Phone only</span></div>{completedRuns.length ? <div className="lab-run-list">{completedRuns.map((job) => <div className="lab-run" key={job.id}><div><strong>{outcomeLabel(job.internalCode)}</strong><span>{new Date(job.createdAt).toLocaleString()} / {formatDuration(job.startedAt, job.completedAt)}</span><code>{job.protocolVersion || "legacy"} / p:{job.policyHash?.slice(0, 8) || "none"} / s:{job.schemaHash?.slice(0, 8) || "none"} / w:{job.workerHash?.slice(0, 8) || "none"}</code></div><span className={`state-badge state-${job.state.toLowerCase()}`}>{stateLabel(job.state)}</span></div>)}</div> : <div className="empty compact"><div><Activity size={25} /><p>No completed runs.</p></div></div>}</div>
      </section>}</div>
    </div>
  </main>;
}
