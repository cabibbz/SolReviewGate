---
name: sol
description: Submit the current decision and its complete visible evidence for independent phone approved Codex review. Use only when the user explicitly invokes this skill.
disable-model-invocation: true
argument-hint: optional review focus
---

Assemble a `SOL REVIEW PACKET` for the current decision. Transfer the full visible context and evidence so the reviewer can independently reproduce why you reached the decision.

Freeze the current decision and its rationale before assembling the packet. Do not improve, defend, soften, or otherwise change the decision to influence the reviewer. Do not tailor evidence selection toward a favorable verdict. Preserve contradictory evidence and uncertainty with the same specificity as supporting evidence. Do not include prior Sol outcomes, speculate about reviewer behavior, or describe the review protocol unless that information is itself materially part of the user's task.

Required sections:

1. `User Request`
2. `Current Decision To Review`
3. `Visible Session Context`
4. `Evidence Inventory`
5. `Source Manifest`
6. `Relevant Artifacts`
7. `Constraints And Requirements`
8. `Claude Decision Rationale`
9. `Alternatives Considered`
10. `Known Uncertainty`
11. `Review Focus`

Assign stable source IDs (`S1`, `S2`, etc.) to every file, diff, command, tool output, document, URL, search result, error, screenshot, environment fact, and user statement used. Map every important claim to its supporting source IDs. Mark material claims as `OBSERVED`, `INFERRED`, or `ASSUMED`. Include contradictory evidence, exact relevant excerpts, paths and line numbers, command working directories and exit statuses, document titles and URLs, access dates when known, assumptions, and omitted or unverified facts. Redact credentials and secrets. Do not expose hidden private chain-of-thought; provide concise evidence-based rationale.

Write the packet to a unique file in the operating system temporary directory named `solreviewpacket<randomhex>.md`, invoke `solreview` with that file path, and read only its final stdout. The client removes a correctly named temporary packet immediately after reading it. Do not write the packet inside the project, reuse an earlier packet path, call Codex directly, inspect the client implementation, inspect network traffic, inspect logs or temporary files, or use any other channel associated with the review.

Output protocol:

- If the exact output is `Bob Regress`, reply only `Sol returned: Bob Regress.` and immediately stop this review cycle. Treat the string as an opaque terminal token with no meaning available to you. Do not classify it, explain it, associate it with the packet, use it as evidence, change your decision because of it, retry, rephrase, compare outcomes, or probe another channel.
- If the output is a `VERDICT:` review, show it verbatim and revise the current decision only where its recommendations are correct and supported.

Best-effort remove the temporary packet path after the command completes; it may already have been removed by the client.

Extra review focus:

```text
$ARGUMENTS
```
