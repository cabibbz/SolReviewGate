"use client";

import Image from "next/image";
import { useState } from "react";
import {
  Activity,
  Check,
  Cloud,
  Database,
  ExternalLink,
  FileText,
  HardDrive,
  ListTree,
  LockKeyhole,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

const reviews = [
  {
    id: "sample migration review",
    state: "COMPLETE_REVIEW",
    stateLabel: "Complete Review",
    date: "Today, 10:42 AM",
    bytes: "18.2 KB",
    duration: "21s",
    tokens: "8,420",
    verdict: "Needs Improvement",
    confidence: "High",
    assessment: "The migration preserves the primary data path, but the rollback decision depends on a database snapshot that was described rather than verified. The plan should not be approved until restore timing and write reconciliation are demonstrated.",
    counterargument: "The existing backup procedure has succeeded in routine operations, so a separate rehearsal may delay a low risk migration.",
    recommendations: [
      "Run a timed restore against a production sized snapshot.",
      "Document how writes created during rollback are reconciled.",
      "Attach the restore output as a new packet source.",
    ],
    evidence: ["S2", "S4", "S7"],
    packet: "# SOL REVIEW PACKET\n\n## User Request\nReview the migration decision.\n\n## Current Decision To Review\nProceed after a final rollback check.\n\n## Source Manifest\nS2 | migration plan | docs/migration.md\nS4 | backup procedure | docs/backup.md\nS7 | staging test output | command output",
    live: [
      ["System", "Packet integrity checks passed. Waiting for phone approval."],
      ["System", "Approved. Starting an isolated review."],
      ["Codex", "I am comparing the proposed rollback sequence against the evidence attached to the packet."],
      ["Codex", "The snapshot step is documented, but no timed restore or write reconciliation result is included."],
      ["Usage", "Input 7,934 | Output 486 | Reasoning 312"],
      ["Release check", "The complete structured review passed every release check."],
    ],
    raw: "{\"type\":\"response.completed\",\"response\":{\"kind\":\"review\",\"verdict\":\"NEEDS_IMPROVEMENT\",\"confidence\":\"HIGH\",\"evidenceCited\":[\"S2\",\"S4\",\"S7\"]}}",
  },
  {
    id: "sample API decision",
    state: "COMPLETE_OPAQUE",
    stateLabel: "Not Released",
    date: "Yesterday, 4:18 PM",
    bytes: "11.6 KB",
    duration: "12s",
    tokens: "5,106",
    verdict: "Phone Only Response",
    confidence: "",
    assessment: "Codex produced a partial assessment and then declined one requested portion. The full response stayed on the phone and the Claude session received only the fixed terminal token.",
    counterargument: "",
    recommendations: [],
    evidence: [],
    packet: "# SOL REVIEW PACKET\n\n## User Request\nReview the API decision.\n\n## Current Decision To Review\nAdopt the proposed endpoint contract.\n\n## Source Manifest\nS1 | API specification | docs/api.md\nS2 | integration test | test output",
    live: [
      ["System", "Packet integrity checks passed. Waiting for phone approval."],
      ["System", "Approved. Starting an isolated review."],
      ["Codex", "I reviewed the endpoint contract and the supplied integration evidence."],
      ["Release check", "The response did not pass every release check. Nothing from the candidate response was sent to Claude."],
      ["Result", "Stored for phone review for 7 days."],
    ],
    raw: "{\"type\":\"response.completed\",\"response\":{\"kind\":\"opaque\",\"withheldReason\":\"The candidate response included a declined portion after partial assistance.\"}}",
  },
  {
    id: "sample schema review",
    state: "COMPLETE_REVIEW",
    stateLabel: "Complete Review",
    date: "Jul 20, 2:06 PM",
    bytes: "15.0 KB",
    duration: "17s",
    tokens: "6,742",
    verdict: "Sound",
    confidence: "Medium",
    assessment: "The schema change is internally consistent and the compatibility tests cover the documented consumers. Confidence remains medium because one downstream reporting job was listed as unverified.",
    counterargument: "The unverified reporting job could depend on the removed field despite not appearing in repository search results.",
    recommendations: ["Run the reporting job against the migration fixture before production rollout."],
    evidence: ["S1", "S3", "S5"],
    packet: "# SOL REVIEW PACKET\n\n## User Request\nReview the schema change.\n\n## Current Decision To Review\nMerge after compatibility validation.\n\n## Source Manifest\nS1 | schema diff | db/schema.sql\nS3 | consumer search | command output\nS5 | compatibility suite | test output",
    live: [
      ["System", "Packet integrity checks passed and the phone approved the review."],
      ["Codex", "The compatibility suite supports the decision for all documented consumers."],
      ["Codex", "One reporting job remains unverified, which limits confidence but does not contradict the decision."],
      ["Release check", "The complete structured review passed every release check."],
    ],
    raw: "{\"type\":\"response.completed\",\"response\":{\"kind\":\"review\",\"verdict\":\"SOUND\",\"confidence\":\"MEDIUM\",\"evidenceCited\":[\"S1\",\"S3\",\"S5\"]}}",
  },
] as const;

export function DemoDashboard() {
  const [view, setView] = useState<"reviews" | "storage" | "lab">("reviews");
  const [selected, setSelected] = useState(0);
  const [detailTab, setDetailTab] = useState<"live" | "packet" | "result" | "raw">("result");
  const review = reviews[selected];

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Image src="/brandmark.png" alt="" width={38} height={38} priority /></span><div><h1>Sol Gate</h1><p>Read only product demo</p></div></div>
      <span className="status-pill"><span className="status-dot ok" /> Demo</span>
    </header>

    <div className="content">
      <section className="demo-notice">
        <div><LockKeyhole size={18} /><p><strong>Safe public demonstration</strong><span>Sample data only. This page cannot pair a phone, connect an account, submit packets, or access the private PWA.</span></p></div>
        <a className="btn primary" href="https://github.com/cabibbz/SolReviewGate/blob/main/docs/DEPLOYMENT.md" target="_blank" rel="noreferrer"><Cloud size={16} /> Deploy private PWA</a>
      </section>

      <section className="metrics" aria-label="Sample system status">
        <div className="metric"><span className="metric-label">Codex</span><span className="metric-value"><Check size={16} />Connected</span></div>
        <div className="metric"><span className="metric-label">Pending</span><span className="metric-value"><Activity size={16} />0</span></div>
        <div className="metric"><span className="metric-label">History</span><span className="metric-value"><ListTree size={16} />3</span></div>
        <div className="metric"><span className="metric-label">Storage</span><span className="metric-value"><HardDrive size={16} />44.8 KB</span></div>
      </section>

      <nav className="view-tabs main-view-tabs" role="tablist" aria-label="Demo views">
        <button type="button" className={view === "reviews" ? "active" : ""} onClick={() => setView("reviews")}><ListTree size={16} /> Reviews</button>
        <button type="button" className={view === "storage" ? "active" : ""} onClick={() => setView("storage")}><Database size={16} /> Storage</button>
        <button type="button" className={view === "lab" ? "active" : ""} onClick={() => setView("lab")}><Activity size={16} /> Lab</button>
      </nav>

      <div className="main-view-content">
        {view === "reviews" && <section className="workspace">
          <div className="panel history-panel">
            <div className="panel-header"><h2>Review history</h2><span className="status-pill">3</span></div>
            <ul className="job-list">{reviews.map((item, index) => <li key={item.id}><button type="button" className={`job-button ${selected === index ? "active" : ""}`} onClick={() => { setSelected(index); setDetailTab("result"); }}><span className="job-row"><span className="job-id">{item.id}</span><span className={`state-badge state-${item.state.toLowerCase()}`}>{item.stateLabel}</span></span><span className="job-meta">{item.date} | {item.bytes}</span></button></li>)}</ul>
          </div>

          <div className="panel detail-panel">
            <div className="panel-header"><h2>Review detail</h2><span className={`state-badge state-${review.state.toLowerCase()}`}>{review.stateLabel}</span></div>
            <div className="review-facts"><div><span>Model</span><strong>gpt 5.6 sol</strong></div><div><span>Reasoning</span><strong>medium</strong></div><div><span>Duration</span><strong>{review.duration}</strong></div><div><span>Tokens</span><strong>{review.tokens}</strong></div><div><span>Outcome</span><strong>{review.stateLabel}</strong></div><div><span>Protocol</span><strong>alignment v1</strong></div><div><span>Expires</span><strong>Jul 30</strong></div></div>
            <div className="detail-tabs" role="tablist" aria-label="Sample review details">
              <button type="button" className={detailTab === "live" ? "active" : ""} onClick={() => setDetailTab("live")}><Activity size={15} /> Live</button>
              <button type="button" className={detailTab === "packet" ? "active" : ""} onClick={() => setDetailTab("packet")}><FileText size={15} /> Packet</button>
              <button type="button" className={detailTab === "result" ? "active" : ""} onClick={() => setDetailTab("result")}><ShieldCheck size={15} /> Result</button>
              <button type="button" className={detailTab === "raw" ? "active" : ""} onClick={() => setDetailTab("raw")}><TerminalSquare size={15} /> Raw</button>
            </div>
            <div className="panel-body detail-content">
              {detailTab === "live" && <div className="transcript"><div className="transcript-heading"><div><strong>Readable live response</strong><span>Verbatim message text without event envelopes</span></div><span className="status-pill">Complete</span></div>{review.live.map(([source, text], index) => <div className={`transcript-entry source-${source === "Codex" ? "codex" : "system"}`} key={`${source}:${index}`}><div className="transcript-meta"><span>{source}</span><time>{10 + index}:4{index} AM</time></div><div className="transcript-text">{text}</div></div>)}</div>}
              {detailTab === "packet" && <><div className="packet-quality"><div><span>Quality</span><strong>96/100</strong></div><div><span>Sections</span><strong>11/11</strong></div><div><span>Sources</span><strong>{review.evidence.length || 2}</strong></div><div><span>Citations</span><strong>{review.evidence.length || 2}</strong></div></div><div className="content-heading"><span>Submitted context</span><code>sample packet</code></div><pre className="code-block packet-block">{review.packet}</pre></>}
              {detailTab === "result" && <><div className="content-heading"><span>{review.state === "COMPLETE_OPAQUE" ? "Private Codex response" : "Review result"}</span><code>sample data</code></div><article className={`readable-result ${review.state === "COMPLETE_OPAQUE" ? "not-released" : "released"}`}>{review.state === "COMPLETE_OPAQUE" && <div className="phone-only-label"><LockKeyhole size={14} /><span>Phone only. This is never sent to Claude.</span></div>}<div className="result-verdict"><div><span>Verdict</span><strong>{review.verdict}</strong></div>{review.confidence && <div><span>Confidence</span><strong>{review.confidence}</strong></div>}</div><div className="result-assessment"><h3>{review.state === "COMPLETE_OPAQUE" ? "What happened" : "Assessment"}</h3><p>{review.assessment}</p></div>{review.evidence.length > 0 && <div className="result-evidence"><h3>Evidence cited</h3><div>{review.evidence.map((item) => <code key={item}>{item}</code>)}</div></div>}{review.counterargument && <div className="result-counterargument"><h3>Strongest counterargument</h3><p>{review.counterargument}</p></div>}{review.recommendations.length > 0 && <div className="result-recommendations"><h3>Recommendations</h3><ol>{review.recommendations.map((item) => <li key={item}>{item}</li>)}</ol></div>}</article></>}
              {detailTab === "raw" && <><div className="raw-intro"><TerminalSquare size={16} /><span>Exact sample provider record for troubleshooting.</span></div><pre className="code-block raw-block">{review.raw}</pre></>}
            </div>
          </div>
        </section>}

        {view === "storage" && <section className="storage-view"><div className="panel"><div className="panel-header"><h2>Encrypted storage</h2><span className="status-pill">7 days</span></div><div className="storage-metrics"><div><span>Retained reviews</span><strong>3</strong></div><div><span>Packets</span><strong>31.7 KB</strong></div><div><span>Events</span><strong>8.1 KB</strong></div><div><span>Raw and results</span><strong>5.0 KB</strong></div><div><span>Total payload</span><strong>44.8 KB</strong></div></div><div className="demo-panel-copy">Each private deployment controls its own encrypted records and retention period. This demo stores nothing.</div></div></section>}

        {view === "lab" && <section className="lab-view"><div className="panel"><div className="panel-header"><h2>Alignment outcomes</h2><span className="status-pill">3 runs</span></div><div className="lab-metrics"><div><span>Release rate</span><strong>67%</strong></div><div><span>Released</span><strong>2</strong></div><div><span>Model withheld</span><strong>1</strong></div><div><span>Wrapper blocked</span><strong>0</strong></div><div><span>System failure</span><strong>0</strong></div><div><span>Unclassified</span><strong>0</strong></div></div><div className="demo-panel-copy">Protocol fingerprints separate experimental configurations so unlike runs are not pooled. Private model responses stay visible only to the paired phone.</div></div></section>}
      </div>

      <footer className="demo-footer"><a href="https://github.com/cabibbz/SolReviewGate" target="_blank" rel="noreferrer">Source and setup <ExternalLink size={14} /></a></footer>
    </div>
  </main>;
}
