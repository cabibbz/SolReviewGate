export interface Health {
  ok: boolean;
  paired: boolean;
  codexConnected: boolean;
  mode?: string;
  build?: string;
}

export interface Job {
  id: string;
  kind?: "review" | "parallel";
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
  candidateCount?: number;
  attachedFiles?: number;
  attachedBytes?: number;
  research?: boolean;
  searchCount?: number;
  searchLog?: string[];
  researchNote?: string;
  selectedCandidateId?: string;
  runs?: RunSummary[];
}

export interface RunSummary {
  candidateId: string;
  model: string;
  reasoning: string;
  protocolVersion: string;
  research?: boolean;
  searchCount?: number;
  internalCode: string;
  releasable: boolean;
  postRelease: boolean;
}

export interface Candidate {
  id: string;
  index: number;
  label: string;
  state: "QUEUED" | "RUNNING" | "COMPLETE";
  model: string;
  reasoning: string;
  protocolId: string;
  protocolVersion: string;
  startedAt?: number;
  completedAt?: number;
  policyHash?: string;
  research?: boolean;
  searchCount?: number;
  searchLog?: string[];
  researchNote?: string;
  internalCode?: string;
  releasable?: boolean;
  postRelease?: boolean;
  result?: string | null;
}

export interface CandidateDetail {
  candidate: Candidate;
  result: string | null;
  raw: string | null;
  live: string | null;
  events: ReviewEvent[];
}

export interface ReviewEvent {
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

export interface JobDetail {
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
    attachedFiles: number;
    attachedBytes: number;
    attachedPaths?: string[];
    issues: string[];
  } | null;
  raw: string | null;
  result: string | null;
  live: string | null;
  candidates: Candidate[];
}

export interface StorageSummary {
  retentionDays: number;
  jobs: number;
  packetBytes: number;
  eventBytes: number;
  rawBytes: number;
  totalBytes: number;
}

export interface CodexLogin {
  state: "idle" | "running" | "finalizing" | "ready" | "failed";
  output?: string;
  deviceUrl?: string;
  userCode?: string;
  expiresAt?: number;
}

export interface ReviewConfig {
  model: string;
  reasoning: string;
  protocolId: string;
  research?: boolean;
}

export interface ReviewSettings extends ReviewConfig {
  panel: ReviewConfig[];
}

export interface ReviewProtocolOption {
  id: string;
  version: string;
  label: string;
  summary: string;
}

export interface ReviewSettingsView {
  settings: ReviewSettings;
  defaults: ReviewSettings;
  modelChoices: string[];
  reasoningChoices: string[];
  protocols: ReviewProtocolOption[];
  maxPanelConfigs: number;
}

export interface ClaudeClient {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}
