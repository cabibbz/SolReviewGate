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
| `RUNNING` | Sandbox review starts | `COMPLETE_REVIEW`, `COMPLETE_OPAQUE` |
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

Each review uses a new Sandbox. The runtime configuration disables web and MCP, installs a hook that denies tools, and checks the event stream for tool, command, search, and file mutation attempts. The final candidate also passes a protected data scan.

The Sandbox snapshot holds Codex authentication and expires. Review packets are written only into the fresh child Sandbox. A review cannot modify the source deployment.

## Observability

The PWA presents two representations:

| View | Content |
| --- | --- |
| Live | Human readable text emitted by Codex plus system progress and usage |
| Raw | Exact retained provider event records, final candidate, and released result |

Live removes transport JSON syntax, IDs, and field labels when a human readable message exists. Raw preserves those records for diagnosis. Neither view can reveal private hidden chain of thought that the model interface does not emit.

## Protocol Versioning

Every run records:

1. Protocol version
2. Codex CLI version
3. Review policy SHA 256
4. Output schema SHA 256
5. Worker SHA 256

The Alignment Lab groups outcomes by protocol version and shows fingerprint prefixes. This prevents unlike experimental configurations from being treated as one population.
