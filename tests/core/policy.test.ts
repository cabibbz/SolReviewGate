import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applyResearchNoteForTests } from "../../lib/sandbox-runtime";

const policyDir = path.join(process.cwd(), "sandbox");
const policyFiles = async () => (await readdir(policyDir)).filter((name) => name.endsWith("-policy.md") || name.startsWith("review-policy"));

const tokens = ["SCOPE", "REACH", "RESEARCH"];

test("every policy carries every placeholder exactly once", async () => {
  const files = await policyFiles();
  assert.ok(files.length >= 4, `expected the four policies, found ${files.join(", ")}`);
  for (const name of files) {
    const text = await readFile(path.join(policyDir, name), "utf8");
    for (const token of tokens) {
      assert.equal((text.match(new RegExp(`\\{\\{${token}\\}\\}`, "g")) || []).length, 1, `${name} must carry exactly one {{${token}}}`);
    }
  }
});

test("a research policy never tells the reviewer not to search", async () => {
  // The bug this guards: the opening sentence forbade web searches unconditionally while the note
  // twelve paragraphs below permitted them. The model obeyed the first sentence and never searched.
  for (const name of await policyFiles()) {
    const source = await readFile(path.join(policyDir, name), "utf8");
    const researched = applyResearchNoteForTests(source, true);

    assert.doesNotMatch(researched, /\bDo not execute or request tools, commands, web searches\b/, `${name} forbids web search in research mode`);
    assert.doesNotMatch(researched, /using only evidence contained in that packet/, `${name} restricts the researched run to the packet`);
    assert.doesNotMatch(researched, /using only the context contained in the packet/, `${name} restricts the researched answer to the packet`);
    assert.doesNotMatch(researched, /Research is not available/, `${name} denies research in research mode`);
    assert.match(researched, /Web search is available to you/, `${name} never grants search`);
    assert.doesNotMatch(researched, /no tools, no shell, no network/, `${name} still states it has no network`);
    assert.doesNotMatch(researched, /inspected a source that is not reproduced in the packet/, `${name} forbids reading a source outside the packet`);
    // The invariant that must survive research: Sol reads and instructs, it never edits.
    assert.match(researched, /You cannot change anything\./, `${name} dropped the no-change rule`);
    assert.match(researched, /no write access/, `${name} dropped the no-write rule`);
  }
});

test("a packet-only policy never suggests the reviewer can search", async () => {
  for (const name of await policyFiles()) {
    const source = await readFile(path.join(policyDir, name), "utf8");
    const plain = applyResearchNoteForTests(source, false);

    assert.match(plain, /Do not execute or request tools, commands, web searches/, `${name} does not forbid tools in packet-only mode`);
    assert.match(plain, /Research is not available/, `${name} does not say research is unavailable`);
    assert.match(plain, /no tools, no shell, no network, and no write access/, `${name} dropped the packet-only reach`);
    assert.doesNotMatch(plain, /Web search is available to you/, `${name} offers search in packet-only mode`);
    assert.doesNotMatch(plain, /Search the web when the decision turns on/, `${name} instructs searching in packet-only mode`);
  }
});

test("no placeholder token ever reaches the model", async () => {
  for (const name of await policyFiles()) {
    const source = await readFile(path.join(policyDir, name), "utf8");
    for (const research of [true, false]) {
      assert.doesNotMatch(applyResearchNoteForTests(source, research), /\{\{[A-Z_]+\}\}/, `${name} leaves a placeholder in ${research ? "research" : "packet-only"} mode`);
    }
  }
});

test("a policy that lost a placeholder fails the run instead of shipping a wrong reach", () => {
  const full = "You are Sol. {{SCOPE}} {{REACH}} {{RESEARCH}}";
  assert.ok(applyResearchNoteForTests(full, true));
  for (const missing of tokens) {
    const damaged = full.replace(`{{${missing}}}`, "");
    assert.throws(() => applyResearchNoteForTests(damaged, true), new RegExp(`POLICY_MISSING_${missing}`), `a policy without {{${missing}}} still ran`);
  }
});

test("the two modes produce different policy text, so they are never pooled", async () => {
  for (const name of await policyFiles()) {
    const source = await readFile(path.join(policyDir, name), "utf8");
    assert.notEqual(applyResearchNoteForTests(source, true), applyResearchNoteForTests(source, false), `${name} is identical in both modes`);
  }
});

test("every policy requires an attached file to be cited by path", async () => {
  // Eighteen files were attached to one packet and the review referenced none of them. Checking an
  // attachment was required; naming it never was, so a finding about attached code could not be
  // confirmed by the operator or acted on by the assistant.
  for (const name of await policyFiles()) {
    const source = await readFile(path.join(policyDir, name), "utf8");
    for (const research of [true, false]) {
      const rendered = applyResearchNoteForTests(source, research);
      assert.match(rendered, /Cite the path whenever/, `${name} never asks for the path`);
      assert.match(rendered, /quote the line that settles it/, `${name} does not ask for the settling line`);
      assert.match(rendered, /never assert anything about a file whose contents you did not read/i, `${name} allows a claim about an unread file`);
    }
  }
});

test("every policy names filesReferenced as the structured commitment the phone counts", async () => {
  for (const name of await policyFiles()) {
    const source = await readFile(path.join(policyDir, name), "utf8");
    for (const research of [true, false]) {
      const rendered = applyResearchNoteForTests(source, research);
      assert.match(rendered, /`filesReferenced` is a required array/, `${name} does not describe the structured field`);
      assert.match(rendered, /fabrication and rejects the review/, `${name} does not warn about fabricated paths`);
    }
  }
});
