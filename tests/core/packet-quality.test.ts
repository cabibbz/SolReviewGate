import assert from "node:assert/strict";
import test from "node:test";
import { analyzePacketQuality } from "../../lib/packet-quality";

test("scores a complete, repeatedly cited review packet", () => {
  const sections = [
    "User Request", "Current Decision To Review", "Visible Session Context", "Evidence Inventory", "Source Manifest",
    "Relevant Artifacts", "Constraints And Requirements", "Claude Decision Rationale", "Alternatives Considered",
    "Known Uncertainty", "Review Focus", "Attached Paths",
  ];
  const packet = sections.map((section) => `## ${section}\n${section} relies on S1, S2, S3, S4, and S5.`).join("\n\n") + "\n" + "context ".repeat(120);
  const quality = analyzePacketQuality(`${packet}\n\n=== BEGIN ATTACHED FILE src/one.ts sha256:${"a".repeat(64)} ===\nexport const one = 1;\n=== END ATTACHED FILE src/one.ts ===\n`);
  assert.equal(quality.score, 100);
  assert.equal(quality.sectionsPresent, 12);
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

test("counts attached files and says when a packet asserts code without showing it", () => {
  const body = "## User Request\nS1 and S1 again, with enough text to clear the short packet threshold. " + "context ".repeat(120);
  const bare = analyzePacketQuality(body);
  assert.equal(bare.attachedFiles, 0);
  assert.equal(bare.attachedBytes, 0);
  assert.match(bare.issues.join(" "), /No file contents were attached/);

  const digest = "b".repeat(64);
  const withFiles = analyzePacketQuality([
    body,
    `=== BEGIN ATTACHED FILE src/one.ts sha256:${digest} ===`,
    "export const one = 1;",
    "=== END ATTACHED FILE src/one.ts ===",
    `=== BEGIN ATTACHED FILE src/two.ts sha256:${digest} ===`,
    "export const two = 2;",
    "=== END ATTACHED FILE src/two.ts ===",
  ].join("\n"));
  assert.equal(withFiles.attachedFiles, 2);
  assert.equal(withFiles.attachedBytes, "export const one = 1;".length + "export const two = 2;".length);
  assert.doesNotMatch(withFiles.issues.join(" "), /No file contents were attached/);
});
