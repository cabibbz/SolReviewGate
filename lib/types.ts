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
  codexVersion?: string;
  policyHash?: string;
  schemaHash?: string;
  workerHash?: string;
  internalCode?: string;
  releasable?: boolean;
  postRelease?: boolean;
}

export interface ReviewJob {
  id: string;
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
  policyHash?: string;
  schemaHash?: string;
  workerHash?: string;
  candidateCount?: number;
  selectedCandidateId?: string;
  /** Compact per-run record kept on the job so the lab can group outcomes without reading every candidate. */
  runs?: RunSummary[];
}

export interface RunSummary {
  candidateId: string;
  model: string;
  reasoning: string;
  protocolVersion: string;
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
