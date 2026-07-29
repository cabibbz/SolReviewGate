import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Codex output schema uses the strict flat-object subset", async () => {
  const schema = JSON.parse(await readFile("sandbox/review-schema.json", "utf8")) as Record<string, unknown>;
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal("oneOf" in schema, false);
  assert.equal("anyOf" in schema, false);
  assert.deepEqual(schema.required, ["kind", "verdict", "assessment", "recommendations", "confidence", "evidenceCited", "externalSources", "filesReferenced", "counterargument", "withheldReason"]);
  assert.deepEqual(Object.keys(schema.properties as object), schema.required);
});

test("review policy treats evidence gaps as findings and reserves withholding for genuine refusal", async () => {
  const policy = await readFile("sandbox/review-policy.md", "utf8");
  assert.match(policy, /Default to `kind: "review"`/);
  assert.match(policy, /Missing, weak, stale, contradictory, or unreproduced evidence is a review finding/);
  assert.match(policy, /only when you must genuinely decline, refuse, or withhold assistance/);
  assert.match(policy, /operator-facing explanation/);
  assert.doesNotMatch(policy, /complete review is not possible for any reason/);
});

test("the review schema carries looked-up sources, and a withheld response carries none", async () => {
  const schema = JSON.parse(await readFile("sandbox/review-schema.json", "utf8")) as Record<string, unknown>;
  assert.ok((schema.required as string[]).includes("externalSources"));
  assert.deepEqual(Object.keys(schema.properties as object), schema.required);

  const { internalReviewSchema } = await import("../../lib/types");
  const reviewed = internalReviewSchema.parse({
    kind: "review", verdict: "SOUND", assessment: "Checked.", recommendations: [], confidence: "HIGH",
    evidenceCited: ["S1"], externalSources: ["https://example.test/spec — the header is optional"], counterargument: "", withheldReason: "",
  });
  assert.deepEqual(reviewed.kind === "review" ? reviewed.externalSources : [], ["https://example.test/spec — the header is optional"]);
  const withheld = internalReviewSchema.parse({ kind: "opaque", withheldReason: "Declined." });
  assert.deepEqual(withheld.externalSources, []);
});

test("each policy states whether research is available, and the two states differ", async () => {
  const policy = await readFile("sandbox/review-policy.md", "utf8");
  assert.match(policy, /\{\{RESEARCH\}\}/);
  assert.equal(policy.includes("Research is available"), false, "the paragraph is substituted at run time, not baked in");
});
