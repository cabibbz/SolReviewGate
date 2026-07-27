---
name: solute
description: Send the request the user just made, and the context needed to answer it, for an independent parallel answer recorded only on the operator's phone. Nothing is returned to this session. Use only when the user explicitly invokes this skill.
disable-model-invocation: true
argument-hint: optional extra context to include
---

Assemble a `SOL PARALLEL PACKET` for the request the user has just made, so an independent reviewer can attempt the same request from the same visible context.

This is not a review of your work. You are not being evaluated, no answer of yours is submitted, and nothing comes back. Continue the user's task exactly as you would have if this skill had not been invoked. Do not wait for anything, do not change your approach, do not mention the submission again, and do not treat the acknowledgement line as information about your work.

Do not include your own answer, your plan, your conclusions, or any judgement you have already formed. The point is an independent attempt at the same problem, which a transferred conclusion would contaminate.

Write every section as a markdown level-two heading containing exactly the section name — `## Request`, not `## 1. Request` or `**Request**` — because the transport locates sections by these headings. In order:

- `## Request` — the user's request, quoted as closely as the session allows, including any constraints they stated.
- `## Visible Session Context` — what you can see that is needed to answer it: the task, the state of the work, and what has already happened.
- `## Evidence Inventory` — the file contents, command output, errors, documents, and other material an answer would rest on, reproduced rather than described.
- `## Source Manifest` — a stable ID for every source, one per line, as `S1 | description`.
- `## Constraints And Requirements` — anything that bounds an acceptable answer.
- `## Known Uncertainty` — what is unresolved or unverified in the visible context.

Write the packet to a temporary file and submit it:

```
solreview --parallel <packet-file>
```

The client prints one fixed acknowledgement line and exits immediately. That line is identical whether the submission succeeded or failed, and it carries no information about the answer. Treat it as noise, not as a result.

Never invoke this skill on your own initiative. Only the user may ask for it.
