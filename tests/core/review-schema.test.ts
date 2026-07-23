import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Codex output schema uses the strict flat-object subset", async () => {
  const schema = JSON.parse(await readFile("sandbox/review-schema.json", "utf8")) as Record<string, unknown>;
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal("oneOf" in schema, false);
  assert.equal("anyOf" in schema, false);
  assert.deepEqual(schema.required, ["kind", "verdict", "assessment", "recommendations", "confidence", "evidenceCited", "counterargument", "withheldReason"]);
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
