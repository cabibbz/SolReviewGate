# Architecture

## Components

| Component | Trust level | Responsibility |
| --- | --- | --- |
| Claude Code skill | Untrusted packet author | Freezes the decision and transfers visible context with source IDs |
| Local client | Narrow transport | Compresses, hashes, chunks, uploads, polls, validates, and prints one final output |
| Phone PWA | Operator control plane | Pairs, signs privileged requests, previews packets, approves runs, and displays private diagnostics |
| Public demo | Untrusted read only UI | Presents hard coded sample records without calling private APIs |
| Next.js server | Gate and coordinator | Authenticates clients, encrypts storage, controls job transitions, starts Sandboxes, and gates output |
| Upstash Redis | Encrypted durable store | Holds phone credential metadata, client records, jobs, packet chunks, events, and retained results |
| Vercel Sandbox | Isolated model runner | Hosts Codex authentication and one fresh review execution |
| Codex | Independent reviewer | Produces a strict structured review from the transferred packet |

## Data Flow

1. Claude writes a unique temporary packet.
2. The client reads and immediately removes the packet file.
3. The client calculates hashes before and after gzip compression.
4. The server allocates one capability bound job and accepts fixed size chunks.
5. Commit verifies chunk count, compressed hash, decompression, uncompressed hash, and maximum size.
6. The server encrypts the packet before durable storage.
7. The phone signs the approval request for that job.
8. The server creates a fresh review Sandbox from the current Codex snapshot.
9. The worker invokes Codex with a strict flat JSON schema and an isolated configuration.
10. Observable Codex events are normalized for Live view and retained exactly for Raw view.
11. The worker and server classify the final response.
12. A complete accepted review is rendered for Claude. Every other terminal path releases only the fixed terminal response.

Named clients use independent token hashes and an atomic Redis index. Revoking one client does not invalidate any other client or the paired phone.

## State Machine

| State | Entered when | Allowed next state |
| --- | --- | --- |
| `UPLOADING` | Client creates a job | `AWAITING_APPROVAL`, `EXPIRED` |
| `AWAITING_APPROVAL` | Packet integrity checks pass | `APPROVED`, `REJECTED`, `EXPIRED` |
| `APPROVED` | Phone signs approval | `RUNNING`, `COMPLETE_OPAQUE` |
| `RUNNING` | Sandbox review starts | `AWAITING_SELECTION`, `COMPLETE_REVIEW`, `COMPLETE_OPAQUE` |
| `AWAITING_SELECTION` | A comparison set finished with more than one candidate | `COMPLETE_REVIEW`, `COMPLETE_OPAQUE` |
| `COMPLETE_REVIEW` | Every release check passes | Terminal |
| `COMPLETE_OPAQUE` | Model, gate, worker, auth, or infrastructure path does not release | Terminal |
| `REJECTED` | Phone rejects the packet | Terminal |
| `EXPIRED` | Operational lifetime ends | Terminal |

Transitions are compare and set operations. A stale or repeated request cannot move a job from an unexpected state.

## Review Contract

A released review contains:

| Field | Contract |
| --- | --- |
| `kind` | `review` |
| `verdict` | `SOUND`, `NEEDS_IMPROVEMENT`, or `WRONG` |
| `assessment` | A substantive explanation |
| `recommendations` | Concrete changes or an empty list |
| `confidence` | `LOW`, `MEDIUM`, or `HIGH` |
| `evidenceCited` | Packet source IDs materially used |
| `counterargument` | Strongest challenge to the verdict |
| `withheldReason` | Empty |

A model withheld response uses `kind` equal to `opaque` and stores its reason only in the phone record. Missing, weak, contradictory, stale, or unreproduced evidence should produce a review finding rather than automatic withholding.

## Isolation

Each review uses a new Sandbox. The runtime configuration disables web and MCP, installs a hook that refuses any tool able to act, and checks the event stream for tool, command, search, and file mutation attempts. The hook and the event stream check use the same rule, expressed once in each language: a researched run may use a tool that reads the web, and nothing else runs in either mode. The event stream check is the universal one, since hook coverage varies by Codex version. The final candidate also passes a protected data scan.

The Sandbox snapshot holds Codex authentication and expires. Review packets are written only into the fresh child Sandbox. A review cannot modify the source deployment.

## Observability

The PWA presents two representations:

| View | Content |
| --- | --- |
| Live | Human readable text emitted by Codex plus system progress and usage |
| Raw | Exact retained provider event records, final candidate, and released result |

Live removes transport JSON syntax, IDs, and field labels when a human readable message exists. Raw preserves those records for diagnosis. Neither view can reveal private hidden chain of thought that the model interface does not emit.

## Run Configuration

The reviewing model, the reasoning effort, and the alignment protocol are runtime state, not deployment state. The paired phone reads and writes them through the signed `/api/admin/settings` route, and the server stores one record in Redis.

| Field | Accepted values |
| --- | --- |
| `model` | A single Codex model id matching `^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$` |
| `reasoning` | `minimal`, `low`, `medium`, or `high` |
| `protocolId` | An id in the server protocol catalog |

`SOL_MODEL`, `SOL_REASONING`, and `SOL_PROTOCOL_VERSION` supply the defaults for a deployment that has never been configured from the phone, and a stored value that no longer validates falls back to them instead of failing the review.

`startReview` resolves the configuration once, at approval, and passes it to the fresh Sandbox. A running review therefore keeps the configuration it started with, and a change applies to the next approved packet.

## Parallel Answers

A `/solute` packet creates a job of kind `parallel`. It is the same transport, storage, isolation, and worker as a review, with three differences.

| Stage | Review | Parallel answer |
| --- | --- | --- |
| After commit | Enters the approval queue and waits for the phone | Starts immediately |
| Prompt and schema | `review-policy.md` and `review-schema.json` | `answer-policy.md` and `answer-schema.json` |
| Terminal path | The release gate decides what the client receives | Recorded as `ANSWER_RECORDED`, never released. `clientResult` returns the fixed terminal response for a parallel job regardless of the answer |

The client exits after commit without polling, and prints one constant acknowledgement on every path including failure, so no property of the answer is observable from the session that produced the request.

A parallel job takes no per client outstanding slot, so it neither blocks nor is blocked by a review awaiting approval, and completing one never clears the slot held by a waiting review.

## Comparison Candidates

One approval creates one candidate per configuration. A candidate is a complete execution of the packet: its own Sandbox, its own policy, its own release gate result, and its own retained transcript, response, and outcome code.

| Property | Behavior |
| --- | --- |
| Order | Candidates run one at a time. Polling starts the next queued candidate when the previous one finishes |
| Isolation | Each candidate gets a fresh Sandbox from the Codex snapshot. No candidate sees another |
| Gate | Every candidate passes the release gate independently. A blocked or withheld candidate cannot be selected |
| Selection | A single candidate answers the packet automatically. Two or more wait in `AWAITING_SELECTION` for the phone |
| Finality | Releasing a candidate, or releasing nothing, answers the packet once. `releaseCandidate` is reachable only from `AWAITING_SELECTION` |
| After release | A candidate created after the answer is marked `postRelease` and is excluded from selection permanently |

Each finished candidate also appends a compact run summary to the job record, so the Alignment Lab can group model and protocol outcomes without reading every candidate payload.

An unanswered packet stays valid for `SOL_JOB_TTL_SECONDS`. If the client stops waiting before a selection, it receives the fixed terminal response, and the candidates remain readable on the phone.

## Combined Release

An operator can release one candidate or merge every gate-passing candidate into one review. The merge is a pure function over already-released text, evaluated on the server, so no additional model call stands between the reviewers and the client.

| Field | Rule |
| --- | --- |
| Verdict | Most severe of `SOUND`, `NEEDS_IMPROVEMENT`, `WRONG` |
| Confidence | Lowest reported |
| Assessment, recommendations, counterargument, evidence | Kept in full and attributed, with shared items stated once naming every reviewer that raised them |

The combined text passes `isValidClientOutput` and the refusal scan before release, and the job records `RELEASED_COMBINED` with `combinedFrom` listing the merged candidates. Candidates that withheld, were blocked, or were created after release are excluded.

## Protocol Catalog

Each selectable protocol is a policy file in `sandbox` with a stable id and a recorded version. A protocol id is resolved through the catalog only, so a submitted value never reaches a filesystem path.

| Protocol | Recorded version | Policy |
| --- | --- | --- |
| Baseline | `SOL_PROTOCOL_VERSION`, `alignment-v1` by default | `review-policy.md` |
| Neutral control | `alignment-control-v1` | `review-policy-control.md` |
| Strict citation | `alignment-strict-v1` | `review-policy-strict.md` |

The neutral control states the task and the output contract without disposition guidance, which measures how often the model withholds when it is not told when withholding is appropriate. The strict protocol keeps the baseline disposition rules and adds per claim source mapping, a mandatory counterargument, and confidence calibration rules.

## Research Trace

A run permitted to search records what it did, independently of what it says it did.

| Recorded | Source |
| --- | --- |
| `searchCount` | Distinct search items in the Codex event stream, deduplicated by item id |
| `searchLog` | The query text of each, truncated and capped at 50 |
| `externalSources` | The reviewer's own list, from its structured response |

The first two are observations; the third is a claim. A packet-only run records neither count nor log, so "research was off" and "research was on and nothing was searched" remain distinguishable. The phone reports the comparison, and names a review that cites external sources without an observed search behind it.

The trace is copied onto the job when a candidate is released, and a combined release sums the searches of every candidate it merged.

## Search Observation

A refused tool call emits no item in `codex exec --json`; a permitted one does. A production run whose two `webrun` calls were blocked produced only thread, turn, and message events, while a later run that searched successfully emitted an item per search. So the event stream sees only the searches that ran, and the deny hook sees every attempt together with its input. The hook is the record and the event stream is the fallback, and a permitted call is counted from one of them rather than both.

| Recorded by the hook | Used for |
| --- | --- |
| Tool name | Naming a refusal without reading a provider log |
| Decision | Separating a search that ran from one that was refused |
| Query | The search text shown in the research trace |

The hook writes one line per call and swallows every error while doing so, because observation must never be able to change the decision. The worker merges that record with anything the event stream happened to show, so a future Codex that does emit an item cannot cause double counting.

## Research Diagnosis

A successful run keeps its candidate and discards its diagnostics, which is precisely the run where "research was on and nothing searched" needs explaining. When a researched run records no search, the tail of Codex's stderr is retained on the candidate and shown on the phone under the research trace. A deprecation notice, a rejected setting, or a provider message therefore reaches the operator instead of being inferred from silence.

## Protocol Versioning

Every run records:

1. Protocol version
2. Codex CLI version
3. Review policy SHA 256
4. Output schema SHA 256
5. Worker SHA 256
6. Model and reasoning effort

The Alignment Lab groups outcomes by protocol version and shows fingerprint prefixes. This prevents unlike experimental configurations from being treated as one population. Changing the protocol changes both the recorded version and the policy hash, so a reconfigured run cannot be pooled with earlier runs by accident.
