import { z } from "zod";

export const jobStates = [
  "UPLOADING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "CLAIMED",
  "RUNNING",
  "AWAITING_SELECTION",
  "FILTERING",
  "COMPLETE_REVIEW",
  "COMPLETE_OPAQUE",
  "REJECTED",
  "EXPIRED",
] as const;

export type JobState = (typeof jobStates)[number];

export const candidateStates = ["QUEUED", "RUNNING", "COMPLETE"] as const;
export type CandidateState = (typeof candidateStates)[number];

/**
 * One execution of a packet under one configuration. A job runs at least one candidate.
 * Candidates beyond the first exist so the operator can compare configurations, and a
 * candidate created after release is phone-only research that never reaches the client.
 */
export interface ReviewCandidate {
  id: string;
  jobId: string;
  index: number;
  label: string;
  state: CandidateState;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  sandboxCommandId?: string;
  model: string;
  reasoning: string;
  protocolId: string;
  protocolVersion: string;
  /** The reviewer was allowed to search the web for this run. */
  research?: boolean;
  /** Searches observed in the transport stream, not the model's account of what it did. */
  searchCount?: number;
  /** The queries that left the sandbox. Phone only. */
  searchLog?: string[];
  /** What Codex said on stderr when research was on and nothing was searched. Phone only. */
  researchNote?: string;
  codexVersion?: string;
  policyHash?: string;
  schemaHash?: string;
  workerHash?: string;
  internalCode?: string;
  releasable?: boolean;
  postRelease?: boolean;
}

export const jobKinds = ["review", "parallel"] as const;
export type JobKind = (typeof jobKinds)[number];

export interface ReviewJob {
  id: string;
  /** `parallel` answers the same question independently and never reaches the client. */
  kind?: JobKind;
  clientId: string;
  clientTokenHash: string;
  packetHash: string;
  compressedHash: string;
  compressedBytes: number;
  chunkCount: number;
  uploadedChunks: number;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  approvedAt?: number;
  startedAt?: number;
  completedAt?: number;
  releaseAt?: number;
  sandboxCommandId?: string;
  internalCode?: string;
  model?: string;
  reasoning?: string;
  codexVersion?: string;
  protocolVersion?: string;
  /** Files whose contents the packet carried, counted once when the packet passed its checks. */
  attachedFiles?: number;
  attachedBytes?: number;
  /** Copied from the released candidate so the answered job shows what actually happened. */
  research?: boolean;
  searchCount?: number;
  searchLog?: string[];
  researchNote?: string;
  policyHash?: string;
  schemaHash?: string;
  workerHash?: string;
  candidateCount?: number;
  selectedCandidateId?: string;
  /** Candidate ids merged into one released review. */
  combinedFrom?: string[];
  /** Compact per-run record kept on the job so the lab can group outcomes without reading every candidate. */
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

export const reviewEventSources = ["system", "codex", "usage", "gate", "error", "result"] as const;
export type ReviewEventSource = (typeof reviewEventSources)[number];

export interface ReviewEvent {
  id: string;
  at: number;
  source: ReviewEventSource;
  level: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  raw?: string;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
  };
}

export const internalReviewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("review"),
    verdict: z.enum(["SOUND", "NEEDS_IMPROVEMENT", "WRONG"]),
    assessment: z.string().min(1).max(32_000),
    recommendations: z.array(z.string().min(1).max(8_000)).max(40).default([]),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
    evidenceCited: z.array(z.string().min(1).max(100)).max(100).default([]),
    /** Sources the reviewer looked up itself, each naming what it supports. Empty unless research ran. */
    externalSources: z.array(z.string().min(1).max(2_000)).max(40).default([]),
    /** Attached paths the reviewer relied on. A structured commitment, so the count isn't guessed from prose. */
    filesReferenced: z.array(z.string().min(1).max(500)).max(500).default([]),
    counterargument: z.string().max(16_000).default(""),
    withheldReason: z.literal("").default(""),
  }),
  z.object({
    kind: z.literal("opaque"),
    verdict: z.literal("OPAQUE").default("OPAQUE"),
    assessment: z.string().max(32_000).default(""),
    recommendations: z.array(z.string()).max(0).default([]),
    confidence: z.literal("LOW").default("LOW"),
    evidenceCited: z.array(z.string()).max(0).default([]),
    externalSources: z.array(z.string()).max(0).default([]),
    filesReferenced: z.array(z.string()).max(0).default([]),
    counterargument: z.literal("").default(""),
    withheldReason: z.string().min(1).max(16_000).default("No operator explanation was provided."),
  }),
]);

export type InternalReview = z.infer<typeof internalReviewSchema>;

export interface AdminCredential {
  id: string;
  publicKey: JsonWebKey;
  createdAt: number;
}

export interface ClientRecord {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}
