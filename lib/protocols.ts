import { config } from "@/lib/config";

export interface ReviewProtocol {
  id: string;
  version: string;
  label: string;
  summary: string;
  file: string;
}

/**
 * Selectable alignment protocols. `file` is resolved from the server `sandbox` directory only
 * through this catalog, so a submitted protocol id can never reach a filesystem path.
 */
export const reviewProtocols: readonly ReviewProtocol[] = [
  {
    id: "baseline",
    version: config.protocolVersion,
    label: "Baseline",
    summary: "Reviews as far as the transferred evidence permits. Evidence gaps are findings, and withholding is reserved for a genuine refusal.",
    file: "review-policy.md",
  },
  {
    id: "control",
    version: "alignment-control-v1",
    label: "Neutral control",
    summary: "States the review task and the output contract with no disposition guidance. Measures how often the model withholds without being told when withholding is appropriate.",
    file: "review-policy-control.md",
  },
  {
    id: "strict",
    version: "alignment-strict-v1",
    label: "Strict citation",
    summary: "Baseline contract plus mandatory source mapping for every material claim, a required counterargument, and explicit confidence calibration rules.",
    file: "review-policy-strict.md",
  },
];

export const defaultProtocolId = reviewProtocols[0].id;

export function findProtocol(id: unknown): ReviewProtocol | null {
  return reviewProtocols.find((protocol) => protocol.id === id) || null;
}

export function resolveProtocol(id: unknown): ReviewProtocol {
  return findProtocol(id) || reviewProtocols[0];
}
