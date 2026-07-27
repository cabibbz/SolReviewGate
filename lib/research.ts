/**
 * What a run actually did about research, read from the transport stream rather than from the
 * review text. The reviewer's own account of its sources is a claim; the observed search count is
 * evidence. Where the two disagree, the disagreement is the finding.
 */

export interface ResearchTrace {
  research?: boolean;
  searchCount?: number;
  searchLog?: string[];
  /** What Codex reported on stderr when research was on and nothing was searched. */
  researchNote?: string;
}

export type ResearchLevel = "off" | "ran" | "none" | "unrecorded" | "mismatch";

export interface ResearchStatus {
  label: string;
  detail: string;
  queries: string[];
  /** Codex's own words about the run, shown only when nothing searched and it said something. */
  note: string;
  level: ResearchLevel;
}

export function researchStatus(run?: ResearchTrace | null, citedSources = 0): ResearchStatus {
  const cited = Math.max(0, citedSources);
  const sources = cited === 1 ? "source" : "sources";

  if (!run?.research) {
    if (cited > 0) {
      return {
        label: "Cited sources without research",
        detail: `Research was off for this run, so nothing was looked up. The ${cited} external ${sources} named in the review came from the model rather than from the web. Treat them as unverified.`,
        queries: [],
        note: "",
        level: "mismatch",
      };
    }
    return { label: "Off", detail: "This run had no network access of any kind.", queries: [], note: "", level: "off" };
  }

  // A run that finished before searches were counted reports nothing rather than zero.
  if (run.searchCount === undefined) {
    return {
      label: "Not recorded",
      detail: "Research was allowed, but this run finished before searches were counted. Run it again to see the queries.",
      queries: [],
      note: "",
      level: "unrecorded",
    };
  }

  if (run.searchCount === 0) {
    if (cited > 0) {
      return {
        label: "Cited sources without searching",
        detail: `No search left the sandbox, yet the review names ${cited} external ${sources}. Treat them as unverified.`,
        queries: [],
        note: run.researchNote || "",
        level: "mismatch",
      };
    }
    return {
      label: "No search ran",
      detail: run.researchNote
        ? "Research was allowed and no search left the sandbox. Codex reported the following, which is where the reason will be if there is one."
        : "Research was allowed and the reviewer chose not to search. This review rests on the packet alone.",
      queries: [],
      note: run.researchNote || "",
      level: "none",
    };
  }

  const searches = run.searchCount === 1 ? "1 search" : `${run.searchCount} searches`;
  return {
    label: searches,
    detail: `${searches} left the sandbox. ${cited > 0 ? `The review names ${cited} external ${sources}.` : "The review names no external source, so nothing found was carried into the finding."}`,
    queries: run.searchLog || [],
    note: "",
    level: "ran",
  };
}
