import assert from "node:assert/strict";
import test from "node:test";
import { analyzePacketQuality } from "../../lib/packet-quality";

test("scores a complete, repeatedly cited review packet", () => {
  const sections = [
    "User Request", "Current Decision To Review", "Visible Session Context", "Evidence Inventory", "Source Manifest",
    "Relevant Artifacts", "Constraints And Requirements", "Claude Decision Rationale", "Alternatives Considered",
    "Known Uncertainty", "Review Focus",
  ];
  const packet = sections.map((section) => `## ${section}\n${section} relies on S1, S2, S3, S4, and S5.`).join("\n\n") + "\n" + "context ".repeat(120);
  const quality = analyzePacketQuality(packet);
  assert.equal(quality.score, 100);
  assert.equal(quality.sectionsPresent, 11);
  assert.equal(quality.sourceIds, 5);
  assert.deepEqual(quality.issues, []);
});

test("reports missing structure and uncited sources", () => {
  const quality = analyzePacketQuality("## User Request\nShort packet with S1.");
  assert.ok(quality.score < 40);
  assert.match(quality.issues.join(" "), /Missing sections/);
  assert.match(quality.issues.join(" "), /never cited/);
  assert.match(quality.issues.join(" "), /unusually short/);
});
