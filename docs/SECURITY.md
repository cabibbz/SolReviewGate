# Security Model

## Intended Boundary

Sol Review Gate separates three audiences:

| Audience | Receives |
| --- | --- |
| Claude Code session | Complete released review or one fixed terminal response |
| Paired phone operator | Packet, review state, observable events, raw records, usage, classifications, and unreleased model response |
| Server operator | Deployment configuration, encrypted storage access, and infrastructure logs |

The local client is intentionally narrow. It has a submission credential but no phone signing key and no route to phone only records.

## Phone Authentication

The first phone generates a P 256 ECDSA key pair with Web Crypto. The private key is nonexportable and stored in IndexedDB.

Every privileged request contains:

1. Credential ID
2. Fresh signed server challenge
3. Millisecond timestamp
4. HTTP method and path
5. SHA 256 body hash
6. ECDSA signature

Challenges expire and are single use. Pairing is blocked after the first phone credential exists.

## Client Authentication

Client tokens are random bearer credentials. The server stores only their SHA 256 hashes. A token can submit and poll only through a per job capability returned at job creation. It cannot approve a packet or read the admin API.

Treat a client token as sensitive. Create a separate named token per machine. The phone displays a new token once, records recent use, and can revoke that token independently.

The read only `/demo` route uses hard coded sample data and calls no private API. Public visitors to an already paired root PWA are directed to that demo and cannot register clients.

## Run Configuration

The reviewing model, reasoning effort, and alignment protocol are changed only through the phone signed admin API. An unsigned request cannot read or change them.

The model id must match `^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$`, so it cannot begin with a dash or contain whitespace and cannot introduce an extra Codex command line flag. The reasoning effort is restricted to a fixed list because it is interpolated into a Codex configuration assignment. The protocol id selects a policy file through a server side catalog, never through a submitted path.

The policy text, its SHA 256, the model, and the reasoning effort are recorded on the job and shown only in the paired PWA. Neither the protocol selection nor the policy is released to the reviewed client.

## Parallel Answers

`/solute` is a one way transfer. The client uploads, commits, prints a fixed acknowledgement, and exits without reading any result. The server refuses to hand a parallel answer to a client capability even if one asks: `clientResult` returns the fixed terminal response for a parallel job before it looks at anything else.

The acknowledgement is a compile time constant used on every exit path, including a failed upload, so the session that ran the command cannot infer whether the submission worked, how long the answer took, or anything it said.

What the session unavoidably knows is that the command was run, because it ran it. The skill instructs the assistant to continue unchanged and not to treat the acknowledgement as information. That is a behavioral contract, not an enforced boundary, and it carries the same limitation as every other prompt level rule in this repository.

## Research

A review is hermetic by default: no tools, no network, no filesystem. Enabling research for a configuration changes exactly one thing — the sandbox may perform a web search.

The policy states the reviewer's reach once, in the mode the run is in. A policy that forbids search in its opening sentence and permits it later is obeyed at the opening sentence, so the two statements are generated from the same flag rather than written independently.

Three controls remain, and one is relaxed:

1. The worker terminates the run and releases nothing on any command, file change, MCP, or other unexpected event. Only search and fetch events are exempt, and only when the run was started with research enabled. This is the control that makes a review hermetic, because it sees the entire event stream.
2. The `PreToolUse` hook refuses any tool that could act, and in a researched run permits only a tool that reads the web. It does see web search: a production log shows it refusing Codex's `webrun` tool by name. Documentation claiming `PreToolUse` covers only shell and MCP is wrong for this version, and this project believed it until a real run contradicted it. Coverage may still vary by version, so the hook is a first line and the worker remains the control that makes a review hermetic.

Both the hook and the worker match tool and item names by what they do rather than by an enumerated list. An allowlist naming `web_search` refused every search for the entire life of this feature, because the tool is called `webrun`.
3. Codex enables web search by default, so the mode is the only control. Each run's own `config.toml` is written with the research mode for a researched run and `web_search = "disabled"` for every other, and the worker passes the same value on the command line. The two agree, so no override precedence has to be assumed correct. The deprecated `features.web_search_request` is not used.

The default research mode is `cached`, which is served from an OpenAI maintained index rather than fetched from the open web. That is not only what works inside a read only sandbox with no outbound egress; it is also the narrower channel, because the reviewer reads pre indexed results instead of arbitrary live pages. `SOL_RESEARCH_MODE` accepts `indexed` or `live` for a deployment whose sandbox has real egress, and `live` widens the prompt injection surface accordingly.

A `live` search fetches pages as well as issuing queries, so a researched run may emit fetch events. That is the same disclosed egress channel as the query that produced it, and both are counted and shown.

What this costs is stated plainly. A search query is composed by a model holding the packet in context, so packet content can in principle reach a search provider. That is a real egress channel and it did not exist before. Do not enable research for a packet carrying anything you would not type into a search box. Retrieved pages are also untrusted input, and the policy instructs the reviewer to treat page text as data rather than instruction, but that is a prompt level control with the same limits as every other one in this repository.

Every search is counted from the transport stream and its query is retained on the candidate, so the operator sees exactly what left the sandbox rather than the model's account of it. Queries are phone only, like the rest of the candidate record, and never reach the reviewed client.

The count is evidence and the review's `externalSources` list is a claim. Where a review names external sources and no search was observed, the phone says so instead of presenting the citations as retrieved. That is the one case an operator cannot otherwise detect.

Retrieved pages are also a way in, not only a way out: text on a page can try to steer the verdict, and the only control against that is the policy's instruction to treat page text as data. On a packet where the verdict matters, run a comparison set that pairs a researched candidate with a packet-only one. The packet-only run cannot be influenced by anything on the web, so disagreement between the two is your injection signal, and the combined release keeps both.

A researched run is fingerprinted as `<protocol>+research` and its policy text differs, so its policy hash differs too. The lab therefore never compares a researched run against a packet-only one.

## Candidate Selection

A comparison set produces several complete reviews for one packet. Releasing one of them is a phone signed request, and the server enforces four rules:

1. A packet is answered exactly once. Selection is reachable only while the job waits for it, so no answer can be replaced after the client has one.
2. Only a candidate that passed every release check can be selected. A withheld, blocked, or failed candidate cannot be released even by an explicit request.
3. A candidate created after the packet was answered is permanently excluded from selection.
4. Releasing nothing is always available and produces the same fixed terminal response as any other non release path.

Unselected candidates, their transcripts, and their full responses stay in the authenticated PWA. The client cannot learn that a comparison happened, how many candidates ran, or what any of them said.

Two consequences are worth stating plainly. A released review from a comparison set is an operator selected review, so its verdict no longer represents one configuration behaving independently; the Alignment Lab keeps every candidate so the unselected outcomes remain visible. Selection time is also operator time, which makes the response latency of a compared packet reflect human deliberation rather than model work alone.

## Stored Data

Review packets, event streams, raw candidates, and results are encrypted with AES 256 GCM before Redis storage. Ciphertext is bound to its logical key through authenticated additional data. Metadata needed for job indexing remains visible to the server store.

Retention limits exposure but is not secure deletion from provider backups. Delete a completed review in the PWA when immediate removal from the active database is required.

## Release Gate

The model response is accepted only when it:

1. Parses against the required structured schema
2. Contains every required review field
3. Provides a substantive assessment
4. Stays within size limits
5. Contains no protected server value
6. Contains no refusal, policy, or declined assistance language
7. Comes from a worker run without tool attempts, malformed events, or secret leakage

The scan covers the complete response. A useful first section followed by a declined section does not release.

## Failure Behavior

Network errors, timeouts, missing authentication, invalid output, worker rejection, and other terminal failures collapse to the same client response and exit code. Diagnostics remain available on the phone when they were retained.

This design intentionally favors a false block over a partial release.

## Important Limitations

1. Public code cannot keep the protocol meaning secret from an agent that can inspect GitHub.
2. A process with unrestricted access to the user profile can read the local client credential and installed skill.
3. Prompt instructions cannot provide cryptographic nonreactivity. They define an experimental behavior contract.
4. Model reviews can be wrong even when the release gate accepts their structure.
5. Vercel, Upstash, OpenAI, GitHub, and the local operating system remain trusted infrastructure.
6. The PWA is designed for one paired administrator per deployment, not multiuser organizational access.
7. Observable reasoning summaries are not private chain of thought.
8. A public multi tenant service needs real user authentication, tenant namespacing, billing boundaries, and one Codex authorization per tenant. This repository does not claim those controls.

For stronger separation, host the server source in an account or environment that Claude Code cannot access, keep Claude projects outside the client configuration directory, use distinct client tokens, and restrict Claude Code permissions.

## Secret Handling

Never commit:

```text
.env.local
bootstrap-secret.txt
SOL_MASTER_KEY_BASE64
SOL_BOOTSTRAP_SECRET_HASH
Redis credentials
Client tokens
Codex authentication files
```

The repository ignore rules cover the standard local files. Run a secret scanner before publishing forks with additional local configuration.

## Reporting A Vulnerability

Do not open a public issue containing credentials, packet data, raw model output, or a working exploit. Use GitHub private vulnerability reporting for this repository. Include the affected commit, deployment mode, reproduction steps, and impact.
