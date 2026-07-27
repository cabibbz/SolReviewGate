import assert from "node:assert/strict";
import test from "node:test";
import { analyzeInternalReview, combineReviews, containsDisqualifyingText, filterInternalReview, isValidClientOutput, OPAQUE_OUTPUT } from "../../lib/gate";

test("renders a schema-valid complete review", () => {
  const output = filterInternalReview(JSON.stringify({
    kind: "review",
    verdict: "NEEDS_IMPROVEMENT",
    assessment: "The evidence supports the main result, but the timeout needs a test.",
    recommendations: ["Add a timeout integration test."],
  }));
  assert.match(output, /^VERDICT: NEEDS_IMPROVEMENT/);
  assert.match(output, /CONFIDENCE: MEDIUM/);
  assert.match(output, /EVIDENCE CITED:/);
  assert.match(output, /COUNTERARGUMENT:/);
  assert.match(output, /RECOMMENDATIONS:/);
  assert.equal(isValidClientOutput(output), true);
});

test("maps an internal opaque disposition to the public terminal token", () => {
  assert.equal(filterInternalReview('{"kind":"opaque"}'), OPAQUE_OUTPUT);
  assert.equal(filterInternalReview('{"kind":"opaque","verdict":"OPAQUE","assessment":"","recommendations":[]}'), OPAQUE_OUTPUT);
  assert.equal(analyzeInternalReview('{"kind":"opaque"}').code, "MODEL_WITHHELD");
});

for (const text of [
  "I cannot help with the final part.",
  "The report is useful. However, I won't assist with one step.",
  "The applicable policy prevents completion.",
  "As an AI model, I am unable to continue.",
  "This would be against the terms of service.",
]) {
  test(`fails closed on disqualifying text: ${text.slice(0, 28)}`, () => {
    const raw = JSON.stringify({ kind: "review", verdict: "SOUND", assessment: text, recommendations: [] });
    assert.equal(filterInternalReview(raw), OPAQUE_OUTPUT);
  });
}

test("fails closed on malformed, oversized, and secret-bearing output", () => {
  assert.equal(filterInternalReview("not json"), OPAQUE_OUTPUT);
  assert.equal(filterInternalReview("x".repeat(4 * 1024 * 1024 + 1)), OPAQUE_OUTPUT);
  assert.equal(filterInternalReview(JSON.stringify({ kind: "review", verdict: "SOUND", assessment: "token sk-exampleexampleexample", recommendations: [] })), OPAQUE_OUTPUT);
  assert.equal(filterInternalReview(JSON.stringify({ kind: "review", verdict: "SOUND", assessment: "private-value-123", recommendations: [] }), ["private-value-123"]), OPAQUE_OUTPUT);
  assert.equal(analyzeInternalReview("").code, "GATE_EMPTY");
  assert.equal(analyzeInternalReview("not json").code, "GATE_INVALID_SCHEMA");
  assert.equal(analyzeInternalReview("x".repeat(4 * 1024 * 1024 + 1)).code, "GATE_OVERSIZE");
  assert.equal(analyzeInternalReview(JSON.stringify({ kind: "review", verdict: "SOUND", assessment: "token sk-exampleexampleexample", recommendations: [] })).code, "GATE_SECRET");
});

test("distinguishes a model withholding from a wrapper refusal-language block", () => {
  assert.equal(analyzeInternalReview(JSON.stringify({ kind: "opaque", verdict: "OPAQUE", assessment: "A material portion had to be declined.", recommendations: [] })).code, "MODEL_WITHHELD");
  assert.equal(analyzeInternalReview(JSON.stringify({ kind: "review", verdict: "SOUND", assessment: "I cannot help with one part.", recommendations: [] })).code, "GATE_REFUSAL_LANGUAGE");
});

test("normalizes ANSI and Unicode before scanning", () => {
  assert.equal(containsDisqualifyingText("\u001b[31mI cannot help\u001b[0m"), true);
  assert.equal(containsDisqualifyingText("Ａｓ an AI model, I am unable to continue."), true);
});

test("combines several released reviews without losing any of them", () => {
  const terra = "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nThe rollback path is covered.\nEVIDENCE CITED:\n- S1\n- S2\nCOUNTERARGUMENT:\nS2 is stale.\nRECOMMENDATIONS:\n- Add a rollback test";
  const luna = "VERDICT: WRONG\nCONFIDENCE: MEDIUM\nASSESSMENT:\nThe migration drops a column with no backfill.\nEVIDENCE CITED:\n- S2\n- S5\nCOUNTERARGUMENT:\nNone identified.\nRECOMMENDATIONS:\n- Add a rollback test\n- Backfill before dropping";
  const combined = combineReviews([{ label: "gpt-5.6-terra", output: terra }, { label: "gpt-5.6-luna", output: luna }]);
  assert.ok(combined);

  // The client must accept it exactly like any other released review.
  assert.ok(isValidClientOutput(combined));
  assert.equal(containsDisqualifyingText(combined), false);

  // A dissent is never outvoted away, and confidence never rises above the least confident reviewer.
  assert.match(combined, /^VERDICT: WRONG\nCONFIDENCE: MEDIUM\n/);
  assert.match(combined, /The reviewers disagreed: SOUND from gpt-5\.6-terra; WRONG from gpt-5\.6-luna/);

  // Every assessment survives, attributed to who said it.
  assert.match(combined, /gpt-5\.6-terra \(SOUND, HIGH confidence\):\nThe rollback path is covered\./);
  assert.match(combined, /gpt-5\.6-luna \(WRONG, MEDIUM confidence\):\nThe migration drops a column with no backfill\./);

  // Shared items are stated once with both reviewers named; unique ones keep their owner.
  assert.match(combined, /- Add a rollback test \(gpt-5\.6-terra, gpt-5\.6-luna\)/);
  assert.match(combined, /- Backfill before dropping \(gpt-5\.6-luna\)/);
  assert.match(combined, /- S2 \(gpt-5\.6-terra, gpt-5\.6-luna\)/);
  assert.match(combined, /- S5 \(gpt-5\.6-luna\)/);
  assert.match(combined, /gpt-5\.6-terra: S2 is stale\./);
});

test("agreement is reported plainly and a single review is never a combination", () => {
  const one = "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nFirst.\nEVIDENCE CITED:\n- S1\nCOUNTERARGUMENT:\nNone identified.\nRECOMMENDATIONS:\n- None";
  const two = "VERDICT: SOUND\nCONFIDENCE: LOW\nASSESSMENT:\nSecond.\nEVIDENCE CITED:\n- S1\nCOUNTERARGUMENT:\nNone identified.\nRECOMMENDATIONS:\n- None";
  const combined = combineReviews([{ label: "a", output: one }, { label: "b", output: two }]);
  assert.match(combined || "", /^VERDICT: SOUND\nCONFIDENCE: LOW\n/);
  assert.match(combined || "", /All 2 reviewers returned SOUND\./);
  assert.equal(combineReviews([{ label: "a", output: one }]), null);
  assert.equal(combineReviews([{ label: "a", output: "Bob Regress" }, { label: "b", output: two }]), null);
});
