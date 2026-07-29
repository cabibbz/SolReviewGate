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
        label: "Cited sources with no search recorded",
        detail: `No search was recorded, yet the review names ${cited} external ${sources}. A search returning nothing is not always reported as an event, so check the review's account before relying on them.`,
        queries: [],
        note: run.researchNote || "",
        level: "mismatch",
      };
    }
    // Never call this a choice. A real transcript shows the reviewer stating it attempted a search
    // and found nothing usable, while the event stream carried no search item at all: a search that
    // returns nothing need not be reported as one. Absence of evidence, stated as such.
    return {
      label: "No search observed",
      detail: run.researchNote
        ? "Research was allowed and no search was recorded. A search that returned nothing is not always reported as an event, so read the review's own account alongside this."
        : "Research was allowed and no search was recorded. That can mean the reviewer did not need one, or that a search returned nothing and was never reported as an event. The review's own text usually says which.",
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


export interface FileEvidence {
  attached: number;
  bytes: number;
  cited: number;
  citedPaths: string[];
  uncitedPaths: string[];
  /** `unused` is the case worth seeing: files were sent and the review grounded itself in none. */
  level: "none" | "used" | "partial" | "unused";
}

/**
 * Files reach the reviewer only as attachments the client pasted into the packet: it has no file
 * access of its own. So "inspected" means available to read, and the honest second number is how
 * many of those the review actually named. A path is counted as cited when the released text
 * mentions it, or mentions its file name where the full path would be unwieldy.
 */
export function fileEvidence(attached: number, bytes: number, paths: string[] = [], reviewText = ""): FileEvidence {
  const text = reviewText.toLowerCase();
  const cited: string[] = [];
  const uncited: string[] = [];
  for (const raw of paths) {
    const path = String(raw).trim();
    if (!path) continue;
    const base = path.split("/").pop() || path;
    const named = text.includes(path.toLowerCase()) || (base.length >= 4 && text.includes(base.toLowerCase()));
    (named ? cited : uncited).push(path);
  }
  const total = Math.max(attached, paths.length);
  return {
    attached: total,
    bytes: Math.max(0, bytes),
    cited: cited.length,
    citedPaths: cited,
    uncitedPaths: uncited,
    level: !total ? "none" : cited.length === 0 ? "unused" : cited.length === total ? "used" : "partial",
  };
}
