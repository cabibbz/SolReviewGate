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

test("the analyzer names the attached paths, not only how many there were", () => {
  const digest = "c".repeat(64);
  const body = "## User Request\nS1 and S1 again, with enough text to clear the short packet threshold. " + "context ".repeat(120);
  const quality = analyzePacketQuality([
    body,
    `=== BEGIN ATTACHED FILE DmaKit/overlay.cpp sha256:${digest} ===`,
    "int main() { return 0; }",
    "=== END ATTACHED FILE DmaKit/overlay.cpp ===",
    `=== BEGIN ATTACHED FILE src/one.ts sha256:${digest} ===`,
    "export const one = 1;",
    "=== END ATTACHED FILE src/one.ts ===",
  ].join("\n"));

  assert.equal(quality.attachedFiles, 2);
  assert.deepEqual(quality.attachedPaths, ["DmaKit/overlay.cpp", "src/one.ts"]);
  assert.ok(quality.attachedBytes > 0);
  // A packet with no attachments reports an empty list rather than a missing one.
  assert.deepEqual(analyzePacketQuality(body).attachedPaths, []);
});

test("headings are matched by their words, not their markup", () => {
  // Each variant is a format a real assembling model has produced from the skill's section list.
  // The exact-match analyzer scored all of these zero and reported every section missing.
  const sections = [
    "User Request", "Current Decision To Review", "Visible Session Context", "Evidence Inventory", "Source Manifest",
    "Relevant Artifacts", "Constraints And Requirements", "Claude Decision Rationale", "Alternatives Considered",
    "Known Uncertainty", "Review Focus", "Attached Paths",
  ];
  const renderings = [
    (section: string, index: number) => `## ${index + 1}. ${section}`,
    (section: string) => `## \`${section}\``,
    (section: string) => `**${section}**`,
    (section: string) => `${section}:`,
    (section: string) => `### ${section}`,
  ];
  for (const render of renderings) {
    const packet = sections.map((section, index) => `${render(section, index)}\nBody citing S1 and S1 again. ${"context ".repeat(20)}`).join("\n\n");
    const quality = analyzePacketQuality(packet);
    assert.equal(quality.sectionsPresent, 12, `${render("User Request", 0)} was not recognized`);
  }

  // CRLF endings, as a Windows client produces.
  const crlf = sections.map((section) => `## ${section}\r\nBody with S1 and S1.`).join("\r\n\r\n");
  assert.equal(analyzePacketQuality(crlf).sectionsPresent, 12);

  // Granted Paths satisfies the attachment section, matching the client.
  const granted = sections.slice(0, -1).map((section) => `## ${section}\nS1 S1`).join("\n") + "\n## Granted Paths\nsrc/app.ts";
  assert.equal(analyzePacketQuality(granted).sectionsPresent, 12);

  // Prose that merely mentions a section name is not a heading.
  const prose = "The User Request was discussed at length in a paragraph that keeps going well past sixty characters so it cannot read as a label.";
  assert.equal(analyzePacketQuality(prose).sectionsPresent, 0);
});
