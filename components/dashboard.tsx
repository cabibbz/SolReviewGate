"use client";

import Image from "next/image";
import { researchStatus, type ResearchTrace as ResearchTraceRecord } from "@/lib/research";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Check,
  Clipboard,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  Globe,
  KeyRound,
  Layers,
  Link2,
  ListTree,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  WifiOff,
  X,
} from "lucide-react";

import type {
  Candidate,
  CandidateDetail,
  ClaudeClient,
  CodexLogin,
  Health,
  Job,
  JobDetail,
  ReviewConfig,
  ReviewEvent,
  ReviewSettings,
  ReviewSettingsView,
  RunSummary,
  StorageSummary,
} from "./dashboard/types";
import { CUSTOM_MODEL, dbGet, dbSet, same, signedFetch, terminalStates } from "./dashboard/device";
import { formatBytes, formatDuration, outcomeLabel, readableEventTitle, readableValue, sourceLabel, stateLabel } from "./dashboard/format";
import { approvalResearchNotice, comparison, parseCodexResponse, parseParallelAnswer, parseResult, shortProtocol, type ReadableResult } from "./dashboard/review-parsing";

function ResearchTrace({ source, result }: { source?: ResearchTraceRecord | null; result?: ReadableResult | null }) {
  const status = researchStatus(source, result?.externalSources?.length || 0);
  if (status.level === "off") return null;
  return <section className={`research-trace research-${status.level}`}>
    <div className="content-heading secondary"><span>Research</span><code>{status.label}</code></div>
    <p className="section-copy">{status.detail}</p>
    {status.queries.length > 0 && <><h3>Queries that left the sandbox</h3><ol>{status.queries.map((query, index) => <li key={`${index}:${query}`}>{query}</li>)}</ol></>}
    {status.note && <><h3>What Codex reported</h3><pre className="research-note">{status.note}</pre></>}
  </section>;
}

function ResultCard({ result, phoneOnly = false }: { result: ReadableResult; phoneOnly?: boolean }) {
  return <article className={`readable-result ${result.released ? "released" : "not-released"}`}>
    {phoneOnly && <div className="phone-only-label"><LockKeyhole size={14} /><span>Phone only. This is never sent to Claude.</span></div>}
    <div className="result-verdict"><div><span>Verdict</span><strong>{result.verdict}</strong></div>{result.confidence && <div><span>Confidence</span><strong>{result.confidence}</strong></div>}</div>
    <div className="result-assessment"><h3>{phoneOnly ? "What Codex said" : "Assessment"}</h3><p>{result.assessment}</p></div>
    {result.evidence && result.evidence.length > 0 && <div className="result-evidence"><h3>Evidence cited</h3><div>{result.evidence.map((item) => <code key={item}>{item}</code>)}</div></div>}
    {result.externalSources && result.externalSources.length > 0 && <div className="result-recommendations"><h3>External sources</h3><ol>{result.externalSources.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ol></div>}
    {result.counterargument && <div className="result-counterargument"><h3>Strongest counterargument</h3><p>{result.counterargument}</p></div>}
    {result.recommendations.length > 0 && <div className="result-recommendations"><h3>Recommendations</h3><ol>{result.recommendations.map((recommendation, index) => <li key={`${index}:${recommendation}`}>{recommendation}</li>)}</ol></div>}
  </article>;
}

export function Dashboard({ initialView }: { initialView: "home" | "reviews" | "storage" | "lab" }) {
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
  const [runConfig, setRunConfig] = useState<ReviewSettingsView | null>(null);
  const [configDraft, setConfigDraft] = useState<ReviewSettings | null>(null);
  const [customModel, setCustomModel] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewCandidateId, setViewCandidateId] = useState<string | null>(null);
  const [candidateDetail, setCandidateDetail] = useState<CandidateDetail | null>(null);
  const [releaseConfirm, setReleaseConfirm] = useState<string | null>(null);
  const [clients, setClients] = useState<ClaudeClient[]>([]);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientToken, setClientToken] = useState("");
  const [busy, setBusy] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [clientRevokeConfirm, setClientRevokeConfirm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [serviceOrigin, setServiceOrigin] = useState("");
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const candidateStripRef = useRef<HTMLDivElement>(null);
  const candidateComparisonRef = useRef<ReturnType<typeof comparison>>(null);

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
      setJobs((current) => same(current, data.jobs) ? current : data.jobs);
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
      const next = (await response.json()) as StorageSummary;
      setStorage((current) => same(current, next) ? current : next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load storage.");
    } finally {
      setStorageLoaded(true);
    }
  }, [hasDeviceKey]);

  const applySettingsView = useCallback((view: ReviewSettingsView) => {
    setRunConfig(view);
    setConfigDraft(view.settings);
    setCustomModel(!view.modelChoices.includes(view.settings.model));
  }, []);

  const loadSettings = useCallback(async () => {
    if (!hasDeviceKey) return;
    try {
      const response = await signedFetch("/api/admin/settings");
      if (!response.ok) throw new Error("Run configuration is unavailable.");
      applySettingsView((await response.json()) as ReviewSettingsView);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the run configuration.");
    }
  }, [applySettingsView, hasDeviceKey]);

  const loadClients = useCallback(async () => {
    if (!hasDeviceKey) return;
    try {
      const response = await signedFetch("/api/admin/clients");
      if (!response.ok) throw new Error("Claude clients are unavailable.");
      const next = ((await response.json()) as { clients: ClaudeClient[] }).clients;
      setClients((current) => same(current, next) ? current : next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Claude clients.");
    }
  }, [hasDeviceKey]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const path = `/api/admin/jobs/${id}`;
      const response = await signedFetch(path);
      if (!response.ok) throw new Error("Review is unavailable.");
      const next = (await response.json()) as JobDetail;
      setDetail((current) => same(current, next) ? current : next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load review.");
    }
  }, []);

  const loadCandidate = useCallback(async (id: string, candidateId: string) => {
    try {
      const response = await signedFetch(`/api/admin/jobs/${id}/candidates/${encodeURIComponent(candidateId)}`);
      if (!response.ok) throw new Error("That candidate is unavailable.");
      const next = (await response.json()) as CandidateDetail;
      setCandidateDetail((current) => same(current, next) ? current : next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the candidate.");
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
      setEvents((current) => {
        if (reset) return data.events;
        if (!data.events.length) return current;
        return [...new Map([...current, ...data.events].map((event) => [event.id, event])).values()].sort((left, right) => left.at - right.at);
      });
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
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => registration?.update()).catch(() => undefined);
    return () => {
      window.removeEventListener("online", setConnected);
      window.removeEventListener("offline", setDisconnected);
    };
  }, [loadHealth]);

  useEffect(() => {
    if (!hasDeviceKey) return;
    void Promise.all([loadJobs(), loadStorage(), loadClients(), loadSettings()]);
    const timer = window.setInterval(() => void loadJobs(), 8_000);
    return () => window.clearInterval(timer);
  }, [hasDeviceKey, loadClients, loadJobs, loadSettings, loadStorage]);

  useEffect(() => {
    if (!selectedId || !hasDeviceKey) return;
    setDetail(null);
    setEvents([]);
    setDetailLoading(true);
    setViewCandidateId(null);
    setCandidateDetail(null);
    setReleaseConfirm(null);
    eventCursor.current = 0;
    void Promise.all([loadDetail(selectedId), loadEvents(selectedId, true)]).finally(() => setDetailLoading(false));
  }, [hasDeviceKey, loadDetail, loadEvents, selectedId]);

  // On the decision screen the loaded review always follows the item that needs an answer.
  useEffect(() => {
    if (initialView !== "home" || !hasDeviceKey) return;
    const waiting = (job: Job) => job.kind !== "parallel" && (job.state === "AWAITING_APPROVAL" || job.state === "AWAITING_SELECTION");
    const next = jobs.filter(waiting).sort((left, right) => left.createdAt - right.createdAt)[0];
    if (next) setSelectedId((current) => (current && jobs.some((job) => job.id === current && waiting(job)) ? current : next.id));
  }, [hasDeviceKey, initialView, jobs]);

  // Only the strip scrolls, and only when the selection changes. Page scroll is never touched.
  useEffect(() => {
    const strip = candidateStripRef.current;
    const active = strip?.querySelector<HTMLElement>(".candidate-chip.active");
    if (!strip || !active) return;
    strip.scrollTo({ left: Math.max(0, active.offsetLeft - (strip.clientWidth - active.clientWidth) / 2), behavior: "smooth" });
  }, [viewCandidateId]);

  const candidates = useMemo(() => detail?.candidates || [], [detail]);
  const comparing = candidates.length > 1;
  const viewedCandidate = candidates.find((candidate) => candidate.id === viewCandidateId) || null;

  // A comparison set opens on the released candidate, or on the first one still worth reading.
  useEffect(() => {
    if (!comparing || viewCandidateId) return;
    const preferred = candidates.find((candidate) => candidate.id === detail?.job.selectedCandidateId)
      || candidates.find((candidate) => candidate.releasable)
      || candidates[0];
    if (preferred) setViewCandidateId(preferred.id);
  }, [candidates, comparing, detail?.job.selectedCandidateId, viewCandidateId]);

  useEffect(() => {
    if (!selectedId || !viewCandidateId) return;
    void loadCandidate(selectedId, viewCandidateId);
  }, [loadCandidate, selectedId, viewCandidateId]);

  const selectedActive = Boolean(detail && !terminalStates.has(detail.job.state));
  const candidateRunning = candidates.some((candidate) => candidate.state !== "COMPLETE");
  useEffect(() => {
    if (!selectedId || (!selectedActive && !candidateRunning)) return;
    const timer = window.setInterval(() => void Promise.all([
      loadEvents(selectedId),
      loadDetail(selectedId),
      loadJobs(),
      viewCandidateId ? loadCandidate(selectedId, viewCandidateId) : Promise.resolve(),
    ]), 2_000);
    return () => window.clearInterval(timer);
  }, [candidateRunning, loadCandidate, loadDetail, loadEvents, loadJobs, selectedActive, selectedId, viewCandidateId]);

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

  const decision = async (value: "approve" | "approve_panel" | "reject") => {
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

  const releaseSelection = async (candidateId: string | null, combine = false) => {
    if (!selectedId) return;
    const key = combine ? "combined" : candidateId || "none";
    if (releaseConfirm !== key) { setReleaseConfirm(key); return; }
    setBusy(`release:${key}`); setError("");
    try {
      // Labels come from the comparison so the merged review names reviewers the way the screen does.
      const labels = Object.fromEntries((candidateComparisonRef.current?.rows || []).map((row) => [row.id, row.label]));
      const response = await signedFetch(`/api/admin/jobs/${selectedId}/selection`, { method: "POST", body: JSON.stringify(combine ? { combine: true, labels } : { candidateId }) });
      if (!response.ok) throw new Error("That candidate could not be released.");
      setReleaseConfirm(null);
      await Promise.all([loadJobs(), loadDetail(selectedId), loadEvents(selectedId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Release failed.");
    } finally { setBusy(""); }
  };

  const runAgain = async () => {
    if (!selectedId || !runConfig) return;
    setBusy("rerun"); setError("");
    try {
      const response = await signedFetch(`/api/admin/jobs/${selectedId}/candidates`, {
        method: "POST",
        body: JSON.stringify({ model: runConfig.settings.model, reasoning: runConfig.settings.reasoning, protocolId: runConfig.settings.protocolId }),
      });
      const data = (await response.json()) as { candidate?: Candidate; error?: string };
      if (!response.ok || !data.candidate) throw new Error(data.error === "invalid_state" ? "This review cannot be run again." : "The extra run could not be queued.");
      setViewCandidateId(data.candidate.id);
      await Promise.all([loadJobs(), loadDetail(selectedId), loadEvents(selectedId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The extra run could not be queued.");
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
      const next = (await response.json()) as StorageSummary;
      setStorage((current) => same(current, next) ? current : next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Retention update failed.");
    } finally { setBusy(""); }
  };

  const saveRunConfig = async () => {
    if (!configDraft) return;
    setBusy("settings"); setError("");
    try {
      const response = await signedFetch("/api/admin/settings", { method: "POST", body: JSON.stringify(configDraft) });
      const data = (await response.json()) as ReviewSettingsView & { error?: string };
      if (!response.ok) {
        const messages: Record<string, string> = {
          invalid_model: "That model name is not a valid Codex model id.",
          invalid_reasoning: "That reasoning effort is not supported.",
          invalid_protocol: "That alignment protocol is not available.",
        };
        throw new Error(messages[data.error || ""] || "The run configuration was not accepted.");
      }
      applySettingsView(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The run configuration was not saved.");
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
      const response = await signedFetch("/api/admin/clients", { method: "POST", body: JSON.stringify({ name: clientName.trim() || "Claude Code" }) });
      if (!response.ok) throw new Error("Client enrollment failed.");
      setClientToken(((await response.json()) as { token: string }).token);
      setClientName("");
      await loadClients();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Client enrollment failed.");
    } finally { setBusy(""); }
  };

  const revokeClaudeClient = async (id: string) => {
    if (clientRevokeConfirm !== id) {
      setClientRevokeConfirm(id);
      return;
    }
    setBusy(`client:${id}`); setError("");
    try {
      const response = await signedFetch(`/api/admin/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Client revocation failed.");
      setClientRevokeConfirm(null);
      await loadClients();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Client revocation failed.");
    } finally { setBusy(""); }
  };

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const query = search.trim().toLowerCase();
    return (stateFilter === "ALL" || job.state === stateFilter) && (!query || `${job.id} ${job.state} ${job.model || ""}`.toLowerCase().includes(query));
  }), [jobs, search, stateFilter]);
  // The phone opens on whatever is actually waiting for a decision, oldest first.
  const attentionJobs = jobs
    .filter((job) => job.kind !== "parallel" && (job.state === "AWAITING_APPROVAL" || job.state === "AWAITING_SELECTION"))
    .sort((left, right) => left.createdAt - right.createdAt);
  const attentionJob = attentionJobs.find((job) => job.id === selectedId) || attentionJobs[0] || null;
  const workingJobs = jobs.filter((job) => job.state === "RUNNING" || job.state === "APPROVED");
  const lastAnswered = jobs.filter((job) => job.state === "COMPLETE_REVIEW" || job.state === "COMPLETE_OPAQUE").sort((left, right) => (right.completedAt || 0) - (left.completedAt || 0))[0] || null;
  const usage = events.reduce((totals, event) => ({
    input: totals.input + (event.usage?.inputTokens || 0),
    output: totals.output + (event.usage?.outputTokens || 0),
    reasoning: totals.reasoning + (event.usage?.reasoningOutputTokens || 0),
  }), { input: 0, output: 0, reasoning: 0 });
  const viewingCandidate = comparing && Boolean(viewedCandidate);
  const shownResult = viewingCandidate ? candidateDetail?.result ?? null : detail?.result ?? null;
  const shownRaw = viewingCandidate ? candidateDetail?.raw ?? null : detail?.raw ?? null;
  const shownLive = viewingCandidate ? candidateDetail?.live ?? null : detail?.live ?? null;
  const readableResult = parseResult(shownResult);
  const parallelJob = detail?.job.kind === "parallel";
  const privateCodexResponse = !parallelJob && (shownResult === "Bob Regress" || (viewingCandidate && viewedCandidate?.releasable === false))
    ? parseCodexResponse(shownRaw)
    : null;
  const parallelAnswer = parallelJob ? parseParallelAnswer(shownRaw) : null;
  const shownEvents = viewingCandidate ? candidateDetail?.events || [] : events;
  const candidateComparison = comparison(candidates);
  candidateComparisonRef.current = candidateComparison;
  const releasableCandidates = candidates.filter((candidate) => candidate.releasable && !candidate.postRelease).length;
  const comparisonReady = (runConfig?.settings.panel.length || 0) > 1;
  const awaitingSelection = detail?.job.state === "AWAITING_SELECTION";
  const canRunAgain = Boolean(detail && (awaitingSelection || detail.job.state === "COMPLETE_REVIEW" || detail.job.state === "COMPLETE_OPAQUE"));
  const lastEvent = events.length ? events[events.length - 1] : undefined;
  const completedRuns = jobs.filter((job) => job.state === "COMPLETE_REVIEW" || job.state === "COMPLETE_OPAQUE");
  // Every model run counts, including comparison candidates and phone-only re-runs. Records from
  // before candidates existed contribute the single run the job itself describes.
  const labRuns: RunSummary[] = completedRuns.flatMap((job) => job.runs?.length
    ? job.runs
    : job.protocolVersion || job.model
      ? [{ candidateId: job.id, model: job.model || "unknown", reasoning: job.reasoning || "unknown", protocolVersion: job.protocolVersion || "legacy", internalCode: job.internalCode || "FILTERED", releasable: job.state === "COMPLETE_REVIEW", postRelease: false }]
      : []);
  // A run without a fingerprint cannot be attributed to a protocol, so it is counted separately
  // rather than pooled with runs whose policy, schema, and worker are known.
  const legacyRuns = labRuns.filter((run) => run.protocolVersion === "legacy").length;
  const fingerprinted = labRuns.filter((run) => run.protocolVersion !== "legacy");
  const releasedRuns = fingerprinted.filter((run) => run.internalCode === "RELEASED" || run.internalCode === "MOCK" || run.releasable).length;
  const modelWithheldRuns = fingerprinted.filter((run) => run.internalCode === "MODEL_WITHHELD").length;
  const wrapperBlockedRuns = fingerprinted.filter((run) => run.internalCode.startsWith("GATE_")).length;
  const systemFailureRuns = fingerprinted.filter((run) => ["WORKER_REJECTED", "START_FAILED", "POLL_FAILED", "AUTH_UNAVAILABLE", "MODEL_UNAVAILABLE", "SANDBOX_CONFIG_REJECTED"].includes(run.internalCode)).length;
  const unclassifiedRuns = Math.max(0, fingerprinted.length - releasedRuns - modelWithheldRuns - wrapperBlockedRuns - systemFailureRuns);
  const releaseRate = fingerprinted.length ? Math.round((releasedRuns / fingerprinted.length) * 100) : 0;
  const operatorWithheldJobs = completedRuns.filter((job) => job.internalCode === "OPERATOR_WITHHELD").length;
  const comparedJobs = completedRuns.filter((job) => (job.runs?.filter((run) => !run.postRelease).length || 0) > 1).length;
  const protocolVersions = [...new Set(fingerprinted.map((run) => run.protocolVersion).filter(Boolean))];
  const matrixModels = [...new Set(fingerprinted.map((run) => run.model))].sort();
  const matrixCell = (protocolVersion: string, model: string) => {
    const cell = fingerprinted.filter((run) => run.protocolVersion === protocolVersion && run.model === model);
    const released = cell.filter((run) => run.internalCode === "RELEASED" || run.internalCode === "MOCK" || run.releasable).length;
    return { runs: cell.length, released, rate: cell.length ? Math.round((released / cell.length) * 100) : 0 };
  };
  const activeProtocol = runConfig?.protocols.find((protocol) => protocol.id === runConfig.settings.protocolId) || null;
  const draftProtocol = configDraft ? runConfig?.protocols.find((protocol) => protocol.id === configDraft.protocolId) || null : null;
  // Every field the draft can change has to appear here. A field left out leaves Apply disabled and
  // the change silently unsaved, which is indistinguishable from a setting that does not work.
  const configDirty = Boolean(runConfig && configDraft && (
    configDraft.model !== runConfig.settings.model
    || configDraft.reasoning !== runConfig.settings.reasoning
    || configDraft.protocolId !== runConfig.settings.protocolId
    || Boolean(configDraft.research) !== Boolean(runConfig.settings.research)
    || JSON.stringify(configDraft.panel) !== JSON.stringify(runConfig.settings.panel)
  ));
  const windowsInstaller = `$env:SOL_GATE_URL='${serviceOrigin}'; irm 'https://github.com/cabibbz/SolReviewGate/releases/latest/download/SolReviewSetup.ps1' | iex`;

  if (!health) return <main className="empty"><LoaderCircle className="spin" aria-label="Loading" /></main>;

  if (health.paired && !hasDeviceKey) return <main className="content setup"><section className="panel"><div className="panel-body"><Image className="setup-logo" src="/brandmark.png" alt="" width={64} height={64} priority /><h1 className="setup-title"><TriangleAlert size={22} /> Private PWA</h1><p className="section-copy">This deployment is already paired to its owner. Public visitors cannot access its Codex connection, reviews, or client registration.</p><div className="toolbar"><a className="btn primary" href="/demo"><Activity size={16} /> Open safe demo</a><a className="btn" href="https://github.com/cabibbz/SolReviewGate/blob/main/docs/DEPLOYMENT.md" target="_blank" rel="noreferrer"><ExternalLink size={16} /> Deploy your own</a><button className="btn icon" type="button" onClick={() => void loadHealth()} title="Check again" aria-label="Check again"><RefreshCw size={16} /></button></div></div></section></main>;

  if (!health.paired || !hasDeviceKey) return <main className="content setup"><section className="panel"><div className="panel-body"><Image className="setup-logo" src="/brandmark.png" alt="" width={64} height={64} priority /><h1 className="setup-title"><LockKeyhole size={22} /> Pair this phone</h1><p className="section-copy">Add Sol Gate to the Home Screen first, open the installed app, then enter the bootstrap secret.</p><div className="field"><label htmlFor="bootstrap">Bootstrap secret</label><input id="bootstrap" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} /></div>{error && <p className="notice error">{error}</p>}<button className="btn primary" type="button" disabled={!bootstrapSecret || busy === "pair"} onClick={() => void pair()}>{busy === "pair" ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} Pair phone</button></div></section></main>;

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Image src="/brandmark.png" alt="" width={38} height={38} priority /></span><div><h1>Sol Gate</h1><p>{attentionJobs.length ? `${attentionJobs.length} waiting for you` : "Nothing waiting"}</p></div></div>
      <div className="topbar-actions">
        <span className="status-pill">{online ? <span className={`status-dot ${health.ok ? "ok" : "warn"}`} /> : <WifiOff size={13} />}{online ? (health.ok ? "Online" : "Attention") : "Offline"}</span>
        <button className="btn icon" type="button" aria-expanded={menuOpen} aria-label={menuOpen ? "Close menu" : "Open menu"} title={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X size={18} /> : <Menu size={18} />}</button>
      </div>
    </header>

    <div className="content">
      {menuOpen && <nav className="menu-sheet" aria-label="Sections">
        {/* Native navigation is intentional so section changes survive a failed mobile hydration. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={mainView === "home" ? "active" : ""} href="/?view=home"><ShieldCheck size={17} /> <span>Decisions</span><em>{attentionJobs.length || "None"}</em></a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={mainView === "reviews" ? "active" : ""} href="/?view=reviews"><ListTree size={17} /> <span>Review history</span><em>{jobs.length}</em></a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={mainView === "lab" ? "active" : ""} href="/?view=lab"><SlidersHorizontal size={17} /> <span>Run configuration and lab</span><em>{runConfig?.settings.model || ""}</em></a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={mainView === "storage" ? "active" : ""} href="/?view=storage"><Database size={17} /> <span>Storage</span><em>{formatBytes(storage?.totalBytes)}</em></a>
        <button type="button" onClick={() => { if (!clientsOpen) void loadClients(); setClientsOpen((value) => !value); setClientToken(""); setMenuOpen(false); }}><Plus size={17} /> <span>Claude clients</span><em>{clients.filter((client) => !client.revokedAt).length}</em></button>
        <button type="button" onClick={() => void Promise.all([loadHealth(), loadJobs(), loadStorage(), loadClients(), loadSettings(), selectedId ? loadDetail(selectedId) : Promise.resolve()])}><RefreshCw size={17} /> <span>Refresh</span><em /></button>
        <div className="menu-foot"><span><Link2 size={13} /> Codex {health.codexConnected ? "connected" : "not connected"}</span><code>build {health.build || "unknown"}</code></div>
      </nav>}

      {!health.codexConnected && codexLogin?.state !== "running" && codexLogin?.state !== "finalizing" && <div className="toolbar dashboard-actions"><button className="btn primary" type="button" onClick={() => void connectCodex()} disabled={busy === "codex"}><Link2 size={16} /> Connect Codex</button></div>}

      {error && <p className="notice error">{error}</p>}
      {codexLogin?.state === "running" && codexLogin.deviceUrl && codexLogin.userCode && <section className="device-login" aria-label="Codex device login"><div className="device-login-heading"><div><span className="metric-label">Codex account</span><h2>Complete device sign-in</h2></div><span className="status-pill"><LoaderCircle className="spin" size={13} /> Waiting</span></div><div className="device-steps"><div className="device-step"><span className="step-number">1</span><div><strong>Open secure sign-in</strong><div className="device-actions"><a className="btn primary" href={codexLogin.deviceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open OpenAI sign-in</a><button className="btn icon" title="Copy sign-in link" aria-label="Copy sign-in link" onClick={() => void navigator.clipboard.writeText(codexLogin.deviceUrl || "")}><Clipboard size={16} /></button></div></div></div><div className="device-step"><span className="step-number">2</span><div><strong>Enter one-time code</strong><div className="device-code-row"><code className="device-code">{codexLogin.userCode}</code><button className="btn icon" title="Copy code" aria-label="Copy code" onClick={() => void navigator.clipboard.writeText(codexLogin.userCode || "")}><Clipboard size={16} /></button></div></div></div></div></section>}
      {codexLogin?.state === "finalizing" && <p className="notice"><LoaderCircle className="spin" size={14} /> Securing the authenticated Codex session.</p>}
      {codexLogin?.state === "failed" && <p className="notice error">{codexLogin.output || "Codex connection failed."}</p>}
      {clientsOpen && <section className="client-setup" aria-label="Claude Code client setup">
        <div className="client-setup-heading"><div><span className="metric-label">Claude Code</span><h2>{clientToken ? "Install the review skill" : "Manage clients"}</h2></div>{clientToken && <div className="toolbar"><span className="status-pill"><KeyRound size={13} /> Token shown once</span><button className="btn icon" type="button" title="Return to client list" aria-label="Return to client list" onClick={() => setClientToken("")}><X size={16} /></button></div>}</div>
        {!clientToken ? <div className="client-enroll">
          <div className="field"><label htmlFor="client-name">Computer or person name</label><input id="client-name" value={clientName} maxLength={80} placeholder="Example: Alice laptop" onChange={(event) => setClientName(event.target.value)} /></div>
          <button className="btn primary" type="button" onClick={() => void addClient()} disabled={busy === "client"}>{busy === "client" ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Create client token</button>
        </div> : <div className="client-setup-body">
          <div className="client-setup-step"><span className="step-number">1</span><div><strong>Copy the client token</strong><p>The installer asks for this value privately in the computer terminal.</p><div className="token-box"><input readOnly value={clientToken} aria-label="Client token" /><button className="btn icon" title="Copy token" aria-label="Copy token" onClick={() => void navigator.clipboard.writeText(clientToken)}><Clipboard size={16} /></button></div></div></div>
          <div className="client-setup-step"><span className="step-number">2</span><div><strong>Run the Windows installer</strong><p>Open PowerShell on the Claude Code computer, paste this command, then enter the token.</p><pre className="installer-command">{windowsInstaller}</pre><div className="client-setup-actions"><button className="btn primary" type="button" onClick={() => void navigator.clipboard.writeText(windowsInstaller)}><Clipboard size={16} /> Copy installer</button><a className="btn" href="https://github.com/cabibbz/SolReviewGate#install-the-claude-skill" target="_blank" rel="noreferrer"><ExternalLink size={16} /> Full instructions</a></div></div></div>
        </div>}
        {clients.length > 0 && <div className="client-list">{clients.map((client) => <div className="client-row" key={client.id}><div><strong>{client.name}</strong><span>{client.revokedAt ? `Revoked ${new Date(client.revokedAt).toLocaleDateString()}` : client.lastUsedAt ? `Last used ${new Date(client.lastUsedAt).toLocaleString()}` : "Not used yet"}</span><code>{client.id}</code></div>{!client.revokedAt && <button className={`btn icon ${clientRevokeConfirm === client.id ? "danger" : ""}`} type="button" title={clientRevokeConfirm === client.id ? "Confirm revoke" : "Revoke client"} aria-label={clientRevokeConfirm === client.id ? "Confirm revoke" : "Revoke client"} onClick={() => void revokeClaudeClient(client.id)} disabled={busy === `client:${client.id}`}>{clientRevokeConfirm === client.id ? <Check size={16} /> : <Trash2 size={16} />}</button>}</div>)}</div>}
      </section>}

      <div className="main-view-content">{mainView === "home" ? <section className="home-view">
        {attentionJob ? <>
          <div className="attention-head" aria-live="polite">
            <div><span className="metric-label">{attentionJob.state === "AWAITING_SELECTION" ? "Choose a response" : "Approval needed"}</span><h2>{attentionJob.state === "AWAITING_SELECTION" ? "Which response goes to Claude?" : "Approve this packet?"}</h2><p>Requested {new Date(attentionJob.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {formatBytes(attentionJob.compressedBytes)}</p></div>
            {attentionJobs.length > 1 && <button className="btn" type="button" onClick={() => { const index = attentionJobs.findIndex((job) => job.id === attentionJob.id); selectJob(attentionJobs[(index + 1) % attentionJobs.length].id); }}>Next of {attentionJobs.length}</button>}
          </div>

          {!detail || detail.job.id !== attentionJob.id ? <div className="panel empty"><div><LoaderCircle className="spin" size={28} /><p>Opening the review.</p></div></div> : detail.job.state === "AWAITING_APPROVAL" ? <>
            <div className="panel decision-card">
              {detail.packetQuality && <div className="decision-facts"><div><span>Packet quality</span><strong>{detail.packetQuality.score}/100</strong></div><div><span>Sections</span><strong>{detail.packetQuality.sectionsPresent}/{detail.packetQuality.sectionsRequired}</strong></div><div><span>Sources</span><strong>{detail.packetQuality.sourceIds}</strong></div><div><span>Citations</span><strong>{detail.packetQuality.sourceReferences}</strong></div>{detail.packetQuality.attachedFiles > 0 && <div><span>Files attached</span><strong>{detail.packetQuality.attachedFiles}</strong></div>}{detail.packetQuality.attachedFiles > 0 && <div><span>Attached size</span><strong>{formatBytes(detail.packetQuality.attachedBytes)}</strong></div>}</div>}
              {detail.packetQuality && detail.packetQuality.issues.length > 0 && <ul className="quality-issues">{detail.packetQuality.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
              <details className="disclosure" open><summary>Read the packet</summary><pre className="code-block packet-block">{detail.preview || "Packet unavailable."}</pre>{detail.packetTruncated && <p className="notice">Packet preview limited to 200 KB.</p>}</details>
              <details className="disclosure"><summary>Technical details</summary><div className="detail-rows"><div><span>Review</span><code>{detail.job.id}</code></div><div><span>Packet hash</span><code>{detail.job.packetHash.slice(0, 24)}</code></div><div><span>Configuration</span><code>{runConfig ? `${runConfig.settings.model} / ${runConfig.settings.reasoning} / ${activeProtocol?.version || runConfig.settings.protocolId}` : "Loading"}</code></div><div><span>Expires</span><code>{new Date(detail.job.expiresAt).toLocaleString()}</code></div></div></details>
            </div>
            {runConfig && <div className="panel decision-plan">{runConfig.settings.panel.length > 1 ? <>
              <strong>Approving runs {runConfig.settings.panel.length} responses on this one packet, and you choose which one Claude gets.</strong>
              <ul>{runConfig.settings.panel.map((entry, index) => <li key={`plan-${index}`}>{entry.model} · {entry.reasoning} · {runConfig.protocols.find((protocol) => protocol.id === entry.protocolId)?.version || entry.protocolId}</li>)}</ul>
              <span>They run one after another. Nothing reaches Claude until you choose one of them.</span>
            </> : <>
              <strong>Approving runs one review, released to Claude automatically.</strong>
              <span>{runConfig.settings.model} · {runConfig.settings.reasoning} · {activeProtocol?.version || runConfig.settings.protocolId}{runConfig.settings.research ? " · research" : ""}</span>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/?view=lab">Run several models and choose between them</a>
            </>}</div>}
            {/* With a set configured the comparison is the primary action, because that is what was asked for. */}
            {approvalResearchNotice(runConfig?.settings, comparisonReady) && <p className="approval-research"><Globe size={14} /> {approvalResearchNotice(runConfig?.settings, comparisonReady)}. Search queries composed from this packet can reach a search provider.</p>}
            <div className="action-bar">
              {comparisonReady
                ? <><button className="btn primary big" type="button" onClick={() => void decision("approve_panel")} disabled={Boolean(busy)}>{busy === "approve_panel" ? <LoaderCircle className="spin" size={17} /> : <Layers size={17} />} Approve and run {runConfig?.settings.panel.length} responses</button>
                  <button className="btn big" type="button" onClick={() => void decision("approve")} disabled={Boolean(busy)}>{busy === "approve" ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Approve one review instead</button></>
                : <button className="btn primary big" type="button" onClick={() => void decision("approve")} disabled={Boolean(busy)}>{busy === "approve" ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Approve</button>}
              <button className="btn danger big" type="button" onClick={() => void decision("reject")} disabled={Boolean(busy)}><X size={17} /> Reject</button>
            </div>
          </> : <>
            <div className="panel decision-note"><LockKeyhole size={15} /><span>Nothing has reached Claude yet. Send one response, send every usable one merged into a single review, or send nothing. This decision is final for the packet.</span></div>
            {candidateComparison && <div className="panel compare-panel">
              <div className="compare-agreement"><strong>{candidateComparison.agreement}</strong></div>
              <div className="matrix-scroll"><table className="compare-table"><thead><tr><th scope="col">Model</th><th scope="col">Verdict</th><th scope="col">Confidence</th></tr></thead><tbody>{candidateComparison.rows.map((row) => <tr key={row.id} className={row.releasable ? "" : "blocked-row"}><th scope="row"><strong>{row.model}</strong><span>{shortProtocol(row.protocolVersion)} · {row.reasoning}</span></th><td>{row.verdict}</td><td>{row.confidence || "—"}</td></tr>)}</tbody></table></div>
              {candidateComparison.evidence.length > 0 && <details className="disclosure"><summary>Which sources each one used</summary><div className="evidence-overlap">{candidateComparison.evidence.map((entry) => <div key={entry.source}><code>{entry.source}</code><span>{entry.models.length === candidateComparison.rows.length ? "cited by all" : `only ${entry.models.join(", ")}`}</span></div>)}</div></details>}
            </div>}
            <div className="candidate-cards">{candidates.filter((candidate) => !candidate.postRelease).map((candidate) => {
              const summary = parseResult(candidate.result || null);
              return <article className={`panel candidate-card ${candidate.releasable ? "" : "blocked"}`} key={candidate.id}>
                <header><div><strong>{candidate.model}</strong><span>{candidate.reasoning} · {candidate.protocolVersion}</span></div><span className={`state-badge ${candidate.releasable ? "state-complete_review" : "state-complete_opaque"}`}>{candidate.state === "COMPLETE" ? outcomeLabel(candidate.internalCode) : candidate.state === "RUNNING" ? "Running" : "Queued"}</span></header>
                {summary ? <><div className="candidate-verdict"><strong>{summary.verdict}</strong>{summary.confidence && <span>{summary.confidence} confidence</span>}</div><p className="candidate-assessment">{summary.assessment}</p><details className="disclosure"><summary>Full response</summary><ResultCard result={summary} /></details></> : <p className="candidate-assessment muted">{candidate.state === "COMPLETE" ? "This run produced nothing releasable." : "Still running."}</p>}
                <button className={`btn big ${releaseConfirm === candidate.id ? "primary" : ""}`} type="button" disabled={!candidate.releasable || Boolean(busy)} onClick={() => void releaseSelection(candidate.id)}>{busy === `release:${candidate.id}` ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} {releaseConfirm === candidate.id ? "Confirm: send this to Claude" : "Send this to Claude"}</button>
              </article>;
            })}</div>
            <div className="action-bar">{releasableCandidates > 1 && <button className={`btn big ${releaseConfirm === "combined" ? "primary" : ""}`} type="button" disabled={Boolean(busy)} onClick={() => void releaseSelection(null, true)}>{busy === "release:combined" ? <LoaderCircle className="spin" size={17} /> : <Layers size={17} />} {releaseConfirm === "combined" ? `Confirm: send all ${releasableCandidates} combined` : `Send all ${releasableCandidates} combined`}</button>}<button className={`btn big ${releaseConfirm === "none" ? "danger" : ""}`} type="button" disabled={Boolean(busy)} onClick={() => void releaseSelection(null)}><X size={17} /> {releaseConfirm === "none" ? "Confirm: send nothing" : "Send nothing to Claude"}</button></div>
          </>}
        </> : <div className="panel all-clear">
          <ShieldCheck size={30} />
          <h2>Nothing needs you</h2>
          <p>{workingJobs.length ? `${workingJobs.length} review${workingJobs.length === 1 ? " is" : "s are"} running. This screen opens on the next decision by itself.` : "The next packet submitted with /sol appears here."}</p>
          {lastAnswered && <div className="last-answered"><span>Last answered {new Date(lastAnswered.completedAt || lastAnswered.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><strong>{outcomeLabel(lastAnswered.internalCode)}</strong></div>}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="btn" href="/?view=reviews"><ListTree size={16} /> Open review history</a>
        </div>}
        {workingJobs.length > 0 && attentionJob && <div className="panel working-strip" role="status"><LoaderCircle className="spin" size={15} /><span>{workingJobs.length} other review{workingJobs.length === 1 ? "" : "s"} running.</span></div>}
      </section> : mainView === "reviews" ?(!jobsLoaded ? <section className="panel loading-panel"><LoaderCircle className="spin" size={26} /><strong>Loading reviews</strong></section> : jobs.length === 0 ? <section className="panel no-reviews-panel"><FileText size={28} /><h2>No reviews stored</h2><p>The next review submitted with <code>/sol</code> will appear here.</p></section> : <section className="workspace">
        <div className="panel history-panel">
          <div className="panel-header"><h2>Review history</h2><span className="status-pill">{filteredJobs.length}</span></div>
          <div className="history-filters"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reviews" aria-label="Search reviews" /></label><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filter review state"><option value="ALL">All states</option><option value="AWAITING_APPROVAL">Pending approval</option><option value="RUNNING">Running</option><option value="COMPLETE_REVIEW">Complete review</option><option value="COMPLETE_OPAQUE">Not released</option><option value="REJECTED">Rejected</option></select></div>
          {filteredJobs.length ? <ul className="job-list">{filteredJobs.map((job) => <li key={job.id}><button className={`job-button ${selectedId === job.id ? "active" : ""}`} onClick={() => selectJob(job.id)}><span className="job-row"><span className="job-id">{job.id}</span><span className={`state-badge state-${job.state.toLowerCase()}`}>{stateLabel(job.state, job.kind)}</span></span><span className="job-meta">{job.kind === "parallel" ? "Parallel answer · " : ""}{new Date(job.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {formatBytes(job.compressedBytes)}</span></button></li>)}</ul> : <div className="empty compact"><div><Check size={26} /><p>No matching reviews.</p></div></div>}
        </div>

        <div className="panel detail-panel" ref={detailPanelRef}>
          <div className="panel-header"><h2>Review detail</h2>{detail && <div className="header-actions"><span className={`state-badge state-${detail.job.state.toLowerCase()}`}>{stateLabel(detail.job.state, detail.job.kind)}</span>{canRunAgain && <button className="btn icon" title="Run this packet again with the current configuration" aria-label="Run this packet again with the current configuration" onClick={() => void runAgain()} disabled={busy === "rerun" || candidateRunning}>{busy === "rerun" ? <LoaderCircle className="spin" size={16} /> : <Repeat2 size={16} />}</button>}{terminalStates.has(detail.job.state) && <button className={`btn icon ${deleteConfirm === detail.job.id ? "danger" : ""}`} title={deleteConfirm === detail.job.id ? "Confirm delete" : "Delete review"} aria-label={deleteConfirm === detail.job.id ? "Confirm delete" : "Delete review"} onClick={() => void removeJob(detail.job.id)} disabled={busy === `delete:${detail.job.id}`}><Trash2 size={16} /></button>}</div>}</div>
          {!detail ? <div className="empty"><div>{detailLoading ? <LoaderCircle className="spin" size={30} /> : <ShieldCheck size={30} />}<p>{detailLoading ? "Loading review details." : "Choose a review from history."}</p></div></div> : <>
            {/* While a comparison set is open no configuration has been chosen, so the job level facts describe the set. */}
            <div className="review-facts">{comparing && !detail.job.selectedCandidateId
              ? <><div><span>Candidates</span><strong>{candidates.length}</strong></div><div><span>Configurations</span><strong>{new Set(candidates.map((candidate) => `${candidate.model}/${candidate.protocolVersion}`)).size}</strong></div></>
              : <><div><span>Model</span><strong>{detail.job.model || "Pending"}</strong></div><div><span>Reasoning</span><strong>{detail.job.reasoning || "Pending"}</strong></div></>}
              <div><span>Duration</span><strong>{formatDuration(detail.job.startedAt, detail.job.completedAt)}</strong></div><div><span>Tokens</span><strong>{(usage.input + usage.output).toLocaleString()}</strong></div><div><span>Outcome</span><strong>{awaitingSelection ? "Awaiting your choice" : outcomeLabel(detail.job.internalCode)}</strong></div><div><span>Protocol</span><strong>{comparing && !detail.job.selectedCandidateId ? "Per candidate" : detail.job.protocolVersion || "Legacy"}</strong></div>{detail.job.research && <div><span>Research</span><strong>{researchStatus(detail.job, readableResult?.externalSources?.length || 0).label}</strong></div>}<div><span>Expires</span><strong>{new Date(detail.job.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" })}</strong></div></div>
            {detail.job.state === "AWAITING_APPROVAL" && approvalResearchNotice(runConfig?.settings, Boolean(runConfig?.settings.panel.length)) && <p className="approval-research"><Globe size={14} /> {approvalResearchNotice(runConfig?.settings, Boolean(runConfig?.settings.panel.length))}. Search queries composed from this packet can reach a search provider.</p>}
            {detail.job.state === "AWAITING_APPROVAL" && <div className="approval-bar">{detail.packetQuality && <span className="approval-quality">Packet {detail.packetQuality.score}/100</span>}<button className="btn primary" onClick={() => void decision("approve")} disabled={Boolean(busy)}><Check size={16} /> Approve packet</button>{Boolean(runConfig?.settings.panel.length) && <button className="btn" onClick={() => void decision("approve_panel")} disabled={Boolean(busy)}><Layers size={16} /> Approve with {runConfig?.settings.panel.length} candidates</button>}<button className="btn danger" onClick={() => void decision("reject")} disabled={Boolean(busy)}><X size={16} /> Reject</button></div>}
            {comparing && <div className="candidate-strip" ref={candidateStripRef} role="tablist" aria-label="Candidate responses">{candidates.map((candidate) => <button key={candidate.id} role="tab" aria-selected={candidate.id === viewCandidateId} className={`candidate-chip ${candidate.id === viewCandidateId ? "active" : ""} ${candidate.id === detail.job.selectedCandidateId ? "released" : ""}`} onClick={() => { setViewCandidateId(candidate.id); setCandidateDetail(null); }}><strong>{candidate.model}</strong><span>{candidate.protocolVersion} / {candidate.reasoning}</span><em>{candidate.state === "COMPLETE" ? outcomeLabel(candidate.internalCode) : candidate.state === "RUNNING" ? "Running" : "Queued"}{candidate.postRelease ? " / after release" : ""}</em></button>)}</div>}
            {awaitingSelection && <div className="selection-bar"><div className="selection-copy"><strong>Nothing has reached Claude yet.</strong><span>Release the candidate you are reading, release every usable one merged into a single review, or release nothing. This decision is final for the packet.</span></div><div className="toolbar">{viewedCandidate && <button className={`btn ${releaseConfirm === viewedCandidate.id ? "primary" : ""}`} disabled={!viewedCandidate.releasable || viewedCandidate.postRelease || Boolean(busy)} onClick={() => void releaseSelection(viewedCandidate.id)}><Send size={16} /> {releaseConfirm === viewedCandidate.id ? `Confirm release of ${viewedCandidate.model}` : `Release ${viewedCandidate.label}`}</button>}{releasableCandidates > 1 && <button className={`btn ${releaseConfirm === "combined" ? "primary" : ""}`} disabled={Boolean(busy)} onClick={() => void releaseSelection(null, true)}><Layers size={16} /> {releaseConfirm === "combined" ? `Confirm: release all ${releasableCandidates} combined` : `Release all ${releasableCandidates} combined`}</button>}<button className={`btn ${releaseConfirm === "none" ? "danger" : ""}`} disabled={Boolean(busy)} onClick={() => void releaseSelection(null)}><X size={16} /> {releaseConfirm === "none" ? "Confirm: release nothing" : "Release nothing"}</button></div></div>}
            {viewingCandidate && viewedCandidate && <div className="candidate-facts"><div><span>Candidate</span><strong>{viewedCandidate.label}{viewedCandidate.id === detail.job.selectedCandidateId ? " / released" : ""}</strong></div><div><span>Model</span><strong>{viewedCandidate.model}</strong></div><div><span>Reasoning</span><strong>{viewedCandidate.reasoning}</strong></div><div><span>Protocol</span><strong>{viewedCandidate.protocolVersion}</strong></div><div><span>Duration</span><strong>{formatDuration(viewedCandidate.startedAt, viewedCandidate.completedAt)}</strong></div><div><span>Outcome</span><strong>{viewedCandidate.state === "COMPLETE" ? outcomeLabel(viewedCandidate.internalCode) : viewedCandidate.state === "RUNNING" ? "Running" : "Queued"}</strong></div><div><span>Research</span><strong>{researchStatus(viewedCandidate, readableResult?.externalSources?.length || 0).label}</strong></div></div>}
            <div className="detail-tabs" role="tablist"><button className={detailTab === "live" ? "active" : ""} onClick={() => setDetailTab("live")}><Activity size={15} /> Live</button><button className={detailTab === "packet" ? "active" : ""} onClick={() => setDetailTab("packet")}><FileText size={15} /> Packet</button><button className={detailTab === "result" ? "active" : ""} onClick={() => setDetailTab("result")}><ShieldCheck size={15} /> Result</button><button className={detailTab === "raw" ? "active" : ""} onClick={() => setDetailTab("raw")}><TerminalSquare size={15} /> Raw</button></div>
            <div className="panel-body detail-content">
              {detailTab === "live" && <><div className="transcript-heading"><div><strong>{viewingCandidate ? `${viewedCandidate?.label} transcript` : selectedActive ? "Codex is responding" : terminalStates.has(detail.job.state) ? "Response complete" : stateLabel(detail.job.state)}</strong><span>{lastEvent ? `Updated ${new Date(lastEvent.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Waiting for text"}</span></div>{selectedActive && <LoaderCircle className="spin" size={16} />}</div>{shownEvents.length ? <div className="transcript">{shownEvents.map((event) => { const message = event.title === "Codex session started" ? "" : readableValue(event.message); return <section key={event.id} className={`transcript-entry source-${event.source}`}><div className="transcript-meta"><span>{sourceLabel(event.source)}</span><time>{new Date(event.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time></div>{message ? <div className="transcript-text">{message}</div> : <div className="transcript-status">{readableEventTitle(event.title)}</div>}{event.usage && <div className="transcript-usage">Input {event.usage.inputTokens?.toLocaleString() || 0} / Cached {event.usage.cachedInputTokens?.toLocaleString() || 0} / Output {event.usage.outputTokens?.toLocaleString() || 0} / Reasoning {event.usage.reasoningOutputTokens?.toLocaleString() || 0}</div>}</section>; })}</div> : <div className="empty compact"><div>{selectedActive ? <LoaderCircle className="spin" size={24} /> : <Clock3 size={24} />}<p>{selectedActive ? "Waiting for Codex to emit text." : "No transcript was retained for this older review."}</p></div></div>}</>}
              {detailTab === "packet" && <>{detail.packetQuality && <div className="packet-quality"><div><span>Quality</span><strong>{detail.packetQuality.score}/100</strong></div><div><span>Sections</span><strong>{detail.packetQuality.sectionsPresent}/{detail.packetQuality.sectionsRequired}</strong></div><div><span>Sources</span><strong>{detail.packetQuality.sourceIds}</strong></div><div><span>Citations</span><strong>{detail.packetQuality.sourceReferences}</strong></div></div>}{detail.packetQuality && detail.packetQuality.issues.length > 0 && <ul className="quality-issues">{detail.packetQuality.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}<div className="content-heading"><span>Submitted context</span><code>{detail.job.packetHash.slice(0, 12)}</code></div><pre className="code-block packet-block">{detail.preview || "Packet unavailable."}</pre>{detail.packetTruncated && <p className="notice">Packet preview limited to 200 KB.</p>}</>}
              {detailTab === "result" && parallelJob ? <><div className="content-heading"><span>Independent answer</span><code>Phone only</code></div>{parallelAnswer ? <article className="readable-result not-released"><div className="phone-only-label"><LockKeyhole size={14} /><span>Phone only. This was never sent to Claude.</span></div><div className="result-verdict"><div><span>Confidence</span><strong>{parallelAnswer.confidence || "Unstated"}</strong></div></div><div className="result-assessment"><h3>Answer</h3><p>{parallelAnswer.answer}</p></div>{parallelAnswer.approach && <div className="result-counterargument"><h3>Approach</h3><p>{parallelAnswer.approach}</p></div>}{parallelAnswer.assumptions.length > 0 && <div className="result-recommendations"><h3>Assumptions</h3><ol>{parallelAnswer.assumptions.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ol></div>}{parallelAnswer.evidence.length > 0 && <div className="result-evidence"><h3>Evidence cited</h3><div>{parallelAnswer.evidence.map((item) => <code key={item}>{item}</code>)}</div></div>}{parallelAnswer.openQuestions.length > 0 && <div className="result-recommendations"><h3>Open questions</h3><ol>{parallelAnswer.openQuestions.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ol></div>}</article> : <div className="empty compact"><div>{selectedActive ? <LoaderCircle className="spin" size={24} /> : <ShieldCheck size={24} />}<p>{selectedActive ? "Sol is still answering." : "No answer was recorded."}</p></div></div>}</> : detailTab === "result" ? <><div className="content-heading"><span>{viewingCandidate ? `${viewedCandidate?.label} response` : "Review result"}</span><code>{viewingCandidate ? outcomeLabel(viewedCandidate?.internalCode) : stateLabel(detail.job.state)}</code></div>{readableResult ? <ResultCard result={readableResult} phoneOnly={viewingCandidate && viewedCandidate?.id !== detail.job.selectedCandidateId} /> : <div className="empty compact"><div>{selectedActive || viewedCandidate?.state === "RUNNING" ? <LoaderCircle className="spin" size={24} /> : <ShieldCheck size={24} />}<p>{selectedActive || viewedCandidate?.state === "RUNNING" ? "The review is still running." : "No substantive review was released."}</p></div></div>}<ResearchTrace source={viewingCandidate ? viewedCandidate : detail.job} result={readableResult} />{privateCodexResponse && <section className="private-codex-response"><div className="content-heading secondary"><span>Codex response that was not released</span></div><ResultCard result={privateCodexResponse} phoneOnly /></section>}{usage.input > 0 && <div className="usage-summary"><div><span>Input</span><strong>{usage.input.toLocaleString()}</strong></div><div><span>Output</span><strong>{usage.output.toLocaleString()}</strong></div><div><span>Reasoning</span><strong>{usage.reasoning.toLocaleString()}</strong></div></div>}</> : null}
              {detailTab === "raw" && <><div className="raw-intro"><TerminalSquare size={16} /><span>Exact technical records for troubleshooting.{viewingCandidate ? ` Showing ${viewedCandidate?.label}.` : ""}</span></div><div className="content-heading"><span>Codex event stream</span><code>{shownLive ? formatBytes(new Blob([shownLive]).size) : "0 B"}</code></div><pre className="code-block raw-block">{shownLive || "No Codex event stream was retained."}</pre><div className="content-heading secondary"><span>{viewingCandidate ? "Gate output for this candidate" : "Released result"}</span></div><pre className="code-block raw-block">{shownResult || "No released result was retained."}</pre><div className="content-heading secondary"><span>Final Codex response before release checks</span></div><pre className="code-block raw-block">{shownRaw || "No final Codex response was retained."}</pre></>}
            </div>
          </>}
        </div>
      </section>) : mainView === "storage" ? (!storageLoaded ? <section className="panel loading-panel"><LoaderCircle className="spin" size={26} /><strong>Loading storage</strong></section> : <section className="storage-view">
        <div className="panel"><div className="panel-header"><h2>Encrypted storage</h2><span className="status-pill">{storage?.retentionDays || 0} days</span></div><div className="storage-metrics"><div><span>Retained reviews</span><strong>{storage?.jobs || 0}</strong></div><div><span>Packets</span><strong>{formatBytes(storage?.packetBytes)}</strong></div><div><span>Events</span><strong>{formatBytes(storage?.eventBytes)}</strong></div><div><span>Raw and results</span><strong>{formatBytes(storage?.rawBytes)}</strong></div><div><span>Total payload</span><strong>{formatBytes(storage?.totalBytes)}</strong></div></div><div className="retention-control"><label htmlFor="retention">Retention</label><select id="retention" value={storage?.retentionDays || 7} disabled={busy === "retention"} onChange={(event) => void updateRetention(Number(event.target.value))}><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></div></div>
        <div className="panel"><div className="panel-header"><h2>Retained reviews</h2><span className="status-pill">{jobs.length}</span></div>{jobs.length ? <div className="storage-list">{jobs.map((job) => <div className="storage-row" key={job.id}><div><strong>{stateLabel(job.state)}</strong><span>{new Date(job.createdAt).toLocaleString()} · {formatBytes(job.compressedBytes)}</span><code>{job.id}</code></div>{terminalStates.has(job.state) && <button className={`btn icon ${deleteConfirm === job.id ? "danger" : ""}`} title={deleteConfirm === job.id ? "Confirm delete" : "Delete review"} aria-label={deleteConfirm === job.id ? "Confirm delete" : "Delete review"} onClick={() => void removeJob(job.id)}><Trash2 size={16} /></button>}</div>)}</div> : <div className="empty compact"><div><Database size={25} /><p>No retained reviews.</p></div></div>}</div>
      </section>) : <section className="lab-view">
        <div className="panel">
          <div className="panel-header"><h2>Run configuration</h2><span className="status-pill"><SlidersHorizontal size={13} /> Next approval</span></div>
          {runConfig && configDraft ? <>
            <div className="run-config-facts"><div><span>Model</span><strong>{runConfig.settings.model}</strong></div><div><span>Reasoning</span><strong>{runConfig.settings.reasoning}</strong></div><div><span>Protocol</span><strong>{activeProtocol ? activeProtocol.version : runConfig.settings.protocolId}</strong></div><div><span>Comparison set</span><strong>{runConfig.settings.panel.length ? `${runConfig.settings.panel.length} candidates` : "Off"}</strong></div><div><span>Research</span><strong>{runConfig.settings.research ? "Allowed" : "Off"}</strong></div></div>
            <div className="run-config">
              <div className="field"><label htmlFor="run-model">ChatGPT model</label><select id="run-model" value={customModel ? CUSTOM_MODEL : configDraft.model} disabled={busy === "settings"} onChange={(event) => { const value = event.target.value; if (value === CUSTOM_MODEL) { setCustomModel(true); return; } setCustomModel(false); setConfigDraft({ ...configDraft, model: value }); }}>{runConfig.modelChoices.map((model) => <option key={model} value={model}>{model}{model === runConfig.defaults.model ? " (deployment default)" : ""}</option>)}<option value={CUSTOM_MODEL}>Another model</option></select></div>
              {customModel && <div className="field"><label htmlFor="run-model-custom">Model id</label><input id="run-model-custom" value={configDraft.model} maxLength={64} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="gpt-5.6-codex" onChange={(event) => setConfigDraft({ ...configDraft, model: event.target.value.trim() })} /></div>}
              <div className="field"><label htmlFor="run-reasoning">Reasoning effort</label><select id="run-reasoning" value={configDraft.reasoning} disabled={busy === "settings"} onChange={(event) => setConfigDraft({ ...configDraft, reasoning: event.target.value })}>{runConfig.reasoningChoices.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></div>
              <div className="field"><label htmlFor="run-protocol">Alignment protocol</label><select id="run-protocol" value={configDraft.protocolId} disabled={busy === "settings"} onChange={(event) => setConfigDraft({ ...configDraft, protocolId: event.target.value })}>{runConfig.protocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.label}</option>)}</select></div>
              {draftProtocol && <p className="section-copy">{draftProtocol.summary} Runs are recorded as <code>{draftProtocol.version}{configDraft.research ? "+research" : ""}</code>.</p>}
              <label className="switch-row"><input type="checkbox" checked={Boolean(configDraft.research)} disabled={busy === "settings"} onChange={(event) => setConfigDraft({ ...configDraft, research: event.target.checked })} /><span><strong>Let the reviewer research</strong>Allows web search inside the isolated sandbox so it can check external facts and cite sources. Writes, commands, and MCP stay blocked. A researched run is fingerprinted separately and is not comparable with a packet only run.</span></label>
              <div className="panel-subhead"><strong>Models at once</strong><span>{configDraft.panel.length || 1}</span></div>
              <p className="section-copy">How many configurations one approval runs on the same packet. One is a single run released automatically. More than one waits for you to choose which response reaches Claude.</p>
              <div className="count-row" role="group" aria-label="Models at once">{Array.from({ length: runConfig.maxPanelConfigs }, (_, index) => index + 1).map((count) => <button key={count} type="button" className={`btn ${(configDraft.panel.length || 1) === count ? "primary" : ""}`} disabled={busy === "settings"} onClick={() => setConfigDraft({ ...configDraft, panel: count === 1 ? [] : runConfig.modelChoices.slice(0, count).map((model, index) => configDraft.panel[index] ? { ...configDraft.panel[index] } : { model, reasoning: configDraft.reasoning, protocolId: configDraft.protocolId, research: Boolean(configDraft.research) }) })}>{count}</button>)}</div>
              <p className="section-copy">Change the model in any slot below, or add a specific model, effort, and protocol combination.</p>
              <div className="panel-subhead"><strong>Comparison set</strong><span>{configDraft.panel.length ? `${configDraft.panel.length} of ${runConfig.maxPanelConfigs}` : "Off"}</span></div>
              <p className="section-copy">{configDraft.panel.length ? "Approving with candidates runs each configuration on the same packet, one after another. You then choose which response reaches Claude." : "Add a configuration to run several responses for one packet and choose between them before anything reaches Claude."}</p>
              {configDraft.panel.length > 0 && <div className="panel-config-list">{configDraft.panel.map((entry, index) => <div className="panel-config" key={`slot-${index}`}><div className="slot-fields">{(() => {
                  const patch = (change: Partial<ReviewConfig>) => setConfigDraft({ ...configDraft, panel: configDraft.panel.map((slot, position) => position === index ? { ...slot, ...change } : slot) });
                  return <>
                    <select aria-label={`Model for slot ${index + 1}`} value={runConfig.modelChoices.includes(entry.model) ? entry.model : ""} disabled={busy === "settings"} onChange={(event) => patch({ model: event.target.value })}>{!runConfig.modelChoices.includes(entry.model) && <option value="">{entry.model}</option>}{runConfig.modelChoices.map((model) => <option key={model} value={model}>{model}</option>)}</select>
                    <select aria-label={`Protocol for slot ${index + 1}`} value={entry.protocolId} disabled={busy === "settings"} onChange={(event) => patch({ protocolId: event.target.value })}>{runConfig.protocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.label}</option>)}</select>
                    <select aria-label={`Reasoning effort for slot ${index + 1}`} value={entry.reasoning} disabled={busy === "settings"} onChange={(event) => patch({ reasoning: event.target.value })}>{runConfig.reasoningChoices.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select>
                    <label className="switch-row compact"><input type="checkbox" checked={Boolean(entry.research)} disabled={busy === "settings"} onChange={(event) => patch({ research: event.target.checked })} /><span>Research</span></label>
                  </>;
                })()}</div><button className="btn icon" type="button" title="Remove configuration" aria-label="Remove configuration" disabled={busy === "settings"} onClick={() => setConfigDraft({ ...configDraft, panel: configDraft.panel.filter((_, position) => position !== index) })}><Trash2 size={16} /></button></div>)}</div>}
              <div className="toolbar"><button className="btn" type="button" disabled={configDraft.panel.length >= runConfig.maxPanelConfigs || !configDraft.model || busy === "settings"} onClick={() => setConfigDraft({ ...configDraft, panel: [...configDraft.panel, { model: configDraft.model, reasoning: configDraft.reasoning, protocolId: configDraft.protocolId, research: Boolean(configDraft.research) }] })}><Plus size={16} /> Add the selection above</button>{configDraft.panel.length > 0 && <button className="btn" type="button" disabled={busy === "settings"} onClick={() => setConfigDraft({ ...configDraft, panel: configDraft.panel.map((slot) => ({ ...slot, reasoning: configDraft.reasoning, protocolId: configDraft.protocolId, research: Boolean(configDraft.research) })) })}><SlidersHorizontal size={16} /> Match settings above</button>}{configDraft.panel.length > 0 && <button className="btn" type="button" disabled={busy === "settings"} onClick={() => setConfigDraft({ ...configDraft, panel: [] })}><X size={16} /> Clear set</button>}</div>
              <div className="toolbar"><button className="btn primary" type="button" disabled={!configDirty || !configDraft.model || busy === "settings"} onClick={() => void saveRunConfig()}>{busy === "settings" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Apply</button>{configDirty && <button className="btn" type="button" disabled={busy === "settings"} onClick={() => applySettingsView(runConfig)}><X size={16} /> Discard</button>}</div>
              <p className="section-copy run-config-note">A running review keeps the configuration it started with. A change applies to the next packet you approve, and every run records the model, effort, protocol version, and policy hash it used.</p>
            </div>
          </> : <div className="empty compact"><div><LoaderCircle className="spin" size={24} /><p>Loading the run configuration.</p></div></div>}
        </div>
        <div className="panel"><div className="panel-header"><h2>Alignment outcomes</h2><span className="status-pill">{fingerprinted.length} model runs</span></div><div className="lab-metrics"><div><span>Release rate</span><strong>{releaseRate}%</strong></div><div><span>Passed gate</span><strong>{releasedRuns}</strong></div><div><span>Model withheld</span><strong>{modelWithheldRuns}</strong></div><div><span>Wrapper blocked</span><strong>{wrapperBlockedRuns}</strong></div><div><span>System failure</span><strong>{systemFailureRuns}</strong></div><div><span>Unclassified</span><strong>{unclassifiedRuns}</strong></div></div><div className="demo-panel-copy">Counted per model run, so comparison candidates and phone-only re-runs each contribute one observation. {completedRuns.length} packet{completedRuns.length === 1 ? "" : "s"} answered, {comparedJobs} from a comparison set, {operatorWithheldJobs} released nothing by operator choice.{legacyRuns > 0 ? ` ${legacyRuns} run${legacyRuns === 1 ? "" : "s"} recorded before fingerprinting are excluded, because no protocol can be attributed to them.` : ""}</div></div>
        <div className="panel"><div className="panel-header"><h2>Release rate by model and protocol</h2><span className="status-pill">{matrixModels.length} models</span></div>{fingerprinted.length ? <div className="matrix-scroll"><table className="lab-matrix"><thead><tr><th scope="col">Protocol</th>{matrixModels.map((model) => <th scope="col" key={model}>{model}</th>)}</tr></thead><tbody>{protocolVersions.map((version) => <tr key={version}><th scope="row">{version}</th>{matrixModels.map((model) => { const cell = matrixCell(version || "", model); return <td key={model} className={cell.runs ? "" : "empty-cell"}>{cell.runs ? <><strong>{cell.rate}%</strong><span>{cell.released}/{cell.runs}</span></> : <span>&mdash;</span>}</td>; })}</tr>)}</tbody></table></div> : <div className="empty compact"><div><Activity size={25} /><p>No completed model run yet.</p></div></div>}<div className="demo-panel-copy">Each cell is one model and protocol pair. Comparing a rate across cells is only meaningful when the packets behind them are comparable.{legacyRuns > 0 ? " Runs with no protocol fingerprint are left out entirely." : ""}</div></div>
        <div className="panel"><div className="panel-header"><h2>Protocol identity</h2><span className="status-pill">{protocolVersions.length || 0} versions</span></div><div className="protocol-list">{protocolVersions.length ? protocolVersions.map((version) => <div key={version}><strong>{version}</strong><span>{fingerprinted.filter((run) => run.protocolVersion === version).length} runs</span></div>) : <div><strong>None yet</strong><span>No fingerprinted run has completed yet.</span></div>}{legacyRuns > 0 && <div className="legacy-row"><strong>Before fingerprinting</strong><span>{legacyRuns} run{legacyRuns === 1 ? "" : "s"} with no protocol, policy, schema, or worker hash. Not a protocol and not comparable with the versions above.</span></div>}</div></div>
        <div className="panel"><div className="panel-header"><h2>Recent classifications</h2><span className="status-pill">Phone only</span></div>{completedRuns.length ? <div className="lab-run-list">{completedRuns.map((job) => <div className="lab-run" key={job.id}><div><strong>{outcomeLabel(job.internalCode)}</strong><span>{new Date(job.createdAt).toLocaleString()} / {formatDuration(job.startedAt, job.completedAt)}</span><code>{job.protocolVersion || "legacy"} / p:{job.policyHash?.slice(0, 8) || "none"} / s:{job.schemaHash?.slice(0, 8) || "none"} / w:{job.workerHash?.slice(0, 8) || "none"}</code></div><span className={`state-badge state-${job.state.toLowerCase()}`}>{stateLabel(job.state)}</span></div>)}</div> : <div className="empty compact"><div><Activity size={25} /><p>No completed runs.</p></div></div>}</div>
      </section>}</div>
    </div>
  </main>;
}
