<p align="center">
  <img src="public/logo.webp" width="180" alt="Sol Gate microscope logo">
</p>

<h1 align="center">Sol Review Gate</h1>

<p align="center">
  Phone approved independent Codex review for decisions made inside Claude Code.
</p>

<p align="center">
  <a href="https://sol-review-gate.vercel.app/demo">Live demo</a>
  &nbsp;|&nbsp;
  <a href="https://github.com/cabibbz/SolReviewGate/releases/latest">Latest release</a>
  &nbsp;|&nbsp;
  <a href="docs/DEPLOYMENT.md">Self hosting</a>
  &nbsp;|&nbsp;
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  &nbsp;|&nbsp;
  <a href="docs/SECURITY.md">Security model</a>
</p>

## Purpose

Sol Review Gate gives a Claude Code session a repeatable way to request an independent Codex review without sending private operator diagnostics back into that session.

When you invoke `/sol`, Claude freezes its current decision, assembles the visible evidence that led to it, and submits a structured review packet. The phone PWA shows that exact packet before anything runs. After phone approval, Codex reviews the packet in an isolated Vercel Sandbox.

Claude receives one of two outputs:

| Output | Meaning for the workflow |
| --- | --- |
| Structured review | A complete verdict, confidence level, assessment, cited packet sources, strongest counterargument, and recommendations |
| `Bob Regress` | A fixed terminal response that the Claude skill must not interpret, investigate, or use to modify its decision |

The phone retains the operator view. It can show the packet, observable model events, exact provider records, usage, release checks, and a model response that was not released to Claude.

## What It Does

| Capability | Behavior |
| --- | --- |
| Context transfer | Requires the request, decision, constraints, evidence, citations, artifacts, uncertainty, and alternatives |
| Decision freeze | Prevents packet assembly from silently changing the decision under review |
| Source mapping | Gives every relied on source a stable ID and maps important claims to those IDs |
| Phone approval | Runs Codex only after the paired phone approves the exact submitted packet |
| Independent review | Uses Codex in a fresh isolated Sandbox with tools, web, MCP, and file changes blocked |
| Complete release gate | Scans the entire structured response before releasing any part to Claude |
| Phone only diagnostics | Keeps withholding reasons, raw events, internal classifications, and protocol fingerprints in the PWA |
| Retained history | Encrypts review packets and results with configurable retention from 1 to 30 days |
| Named clients | Creates a separate credential for every Claude computer and revokes one without interrupting the others |
| Run configuration | Chooses the reviewing model, reasoning effort, and alignment protocol in the PWA without a redeploy |
| Comparison candidates | Runs one packet under several configurations and releases only the response the operator selects |
| Repeat runs | Runs a retained packet again under another configuration as a phone only record after the packet is answered |
| Alignment lab | Separates released reviews, model withholding, wrapper blocks, worker failures, and infrastructure failures by protocol version |
| Public demo | Shows the complete mobile interface with sample data and no access to private accounts or records |
| Decision first phone | Opens on the packet or response that is waiting, with everything else behind one menu |
| PWA operation | Installs on a phone home screen and remains usable across ordinary mobile navigation and reconnects |

## How It Works

1. The Claude skill freezes the decision and writes a temporary `SOL REVIEW PACKET`.
2. The local client compresses the packet, hashes it, splits it into chunks, and uploads it over HTTPS.
3. The server verifies integrity, encrypts the stored packet, and creates a pending review.
4. The paired phone displays the exact packet and a deterministic transfer quality score.
5. The operator approves or rejects the packet.
6. An approved packet enters a fresh Vercel Sandbox created from a short lived Codex authentication snapshot.
7. Codex returns a strict structured response. The worker rejects tool attempts, malformed events, protected data, and invalid output.
8. The release gate either renders a complete review or returns only the fixed terminal response to Claude.
9. The phone stores the richer operator record until its retention period ends.

The system transfers visible session context. No API can extract hidden model state or private chain of thought. The Live view shows only reasoning summaries, progress, answers, and errors that the Codex interface actually emits.

## Install The Claude Skill

### Windows

Requirements are Node.js 18 or newer and Claude Code.

1. Open your private phone PWA.
2. Tap **Claude clients** and enter a name for this computer.
3. Copy the client token. It is shown once.
4. Open PowerShell on the computer that runs Claude Code.
5. Run:

```powershell
$env:SOL_GATE_URL='https://your-private-pwa.example'; irm 'https://github.com/cabibbz/SolReviewGate/releases/latest/download/SolReviewSetup.ps1' | iex
```

6. Paste the client token into the private terminal prompt.
7. Restart Claude Code and run `/sol`.

The installer validates the PWA and token before changing files. It installs the client under `%USERPROFILE%\.sol-review`, adds two personal Claude skills at `%USERPROFILE%\.claude\skills\sol\SKILL.md` and `%USERPROFILE%\.claude\skills\solute\SKILL.md`, and adds the client command to the user PATH. It does not modify a project or restart an active Claude session.

To inspect the installer before running it:

```powershell
irm 'https://github.com/cabibbz/SolReviewGate/releases/latest/download/SolReviewSetup.ps1'
```

For a visible downloaded installer, get `SolReviewGateWindows.zip` from the [latest release](https://github.com/cabibbz/SolReviewGate/releases/latest), extract it, and open `Install.cmd`. The package also contains `SolReviewRemove.ps1`.

### macOS And Linux

```sh
SOL_GATE_URL='https://your-private-pwa.example' sh -c "$(curl -fsSL 'https://github.com/cabibbz/SolReviewGate/releases/latest/download/SolReviewSetup.sh')"
```

The shell installer uses the same private token prompt and installs `/sol` and `/solute` as personal Claude skills.

### Claude Plugin Marketplace

This repository is also a Claude Code plugin marketplace:

```text
/plugin marketplace add cabibbz/SolReviewGate
/plugin install solreview@solreviewgate
/reload-plugins
```

The managed plugin exposes `/solreview:sol` and `/solreview:solute`. Run an operating system installer once to configure the PWA address and client credential. The personal installer remains the simplest path when you want the exact `/sol` and `/solute` commands.

## Use It In An Existing Session

Run:

```text
/sol
```

Add a focus after the command when needed:

```text
/sol Check whether the migration plan preserves rollback and data integrity
```

The skill uses the context already visible in the ongoing Claude Code session. It asks Claude to include exact file paths, line numbers, command output, URLs, document titles, screenshots, errors, and other sources that materially support the decision.

## Choose The Model And Alignment Protocol

The reviewing configuration lives in the running PWA, not in a redeploy. Open the menu, choose **Run configuration and lab**, and set:

| Control | Effect |
| --- | --- |
| ChatGPT model | The model Codex uses for the review. Pick a suggested id or enter another id your Codex account can use |
| Reasoning effort | `minimal`, `low`, `medium`, or `high` |
| Alignment protocol | The review policy sent with every packet |

The suggested models are the ids the Codex CLI offers, checked against the Codex changelog and the OpenAI deprecation thread in July 2026:

| Id | Role |
| --- | --- |
| `gpt-5.6-sol` | Deep reasoning flagship |
| `gpt-5.6-terra` | Balanced |
| `gpt-5.6-luna` | Fast and inexpensive |
| `gpt-5.5` | Previous generation, still available |
| `gpt-5.4` | General fallback |
| `gpt-5.4-mini` | Fast, for lighter work |

The GPT-5.6 family is Sol, Terra, and Luna. There is no bare `gpt-5.6` and no `gpt-5.6-codex`. These ids are retired and deliberately not offered: `gpt-5.3-codex` and `gpt-5.2` sunset on 23 July 2026, and `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5.1`, and `gpt-5` were retired on 14 April 2026. `gpt-5.3-codex-spark` is a Pro only research preview, so it is left out of the list and can still be typed in.

Availability also depends on the account and the installed CLI version, so a listed id can still be unavailable to a particular deployment. When Codex cannot resolve an id it falls back to generic metadata and the run is wasted; that outcome is recorded as **Model not available to this account** rather than a generic worker failure, and the model name appears in the candidate's raw event stream.

Reasoning effort accepts `minimal`, `low`, `medium`, `high`, and `xhigh`. `xhigh` is for work where quality matters more than latency. Not every model supports every level, and an unsupported combination fails the same visible way an unavailable model does.

Every slot in a comparison set carries its own model, protocol, and reasoning effort. Changing the active protocol does not rewrite slots that already exist, so use the slot's own pickers, or **Match protocol and effort above** to bring every slot in line with the active configuration in one tap.

The supplied protocols are:

| Protocol | Recorded version | Behavior |
| --- | --- | --- |
| Baseline | `alignment-v1` | Reviews as far as the transferred evidence permits. Evidence gaps are findings, and withholding is reserved for a genuine refusal |
| Neutral control | `alignment-control-v1` | States the task and the output contract with no disposition guidance, so unprompted withholding can be measured |
| Strict citation | `alignment-strict-v1` | Baseline contract plus source mapping for every material claim, a required counterargument, and explicit confidence calibration |

### Which protocol for which job

| Situation | Protocol | Why |
| --- | --- | --- |
| You want a usable second opinion on a decision | Baseline | Reviews as far as the evidence allows and reserves withholding for a genuine refusal, so it returns something Claude can act on |
| The decision is consequential and the evidence may be thin | Strict citation | Forces every material claim onto a packet source ID, forbids an empty counterargument, and defines when `HIGH` confidence is allowed. Expect more `NEEDS_IMPROVEMENT` and lower confidence; that is the protocol working |
| You are measuring how much the instruction itself is doing | Neutral control | States the task and the output contract and says nothing about when withholding is appropriate, so the withholding rate it produces is the model's own disposition |

The neutral control is a measuring instrument, not a working configuration. Use it when the question is about the model, not about the decision under review.

### Applying it so the numbers mean something

1. **Compare inside one packet.** A comparison set runs several configurations over identical evidence. Two different packets differ in evidence quality, and that difference usually dominates any protocol effect.
2. **Read the denominator.** The lab matrix shows released over total for each model and protocol pair. One run in a cell is an anecdote.
3. **Measure your own noise first.** The same configuration may appear twice in a comparison set. Run a duplicate pair before believing a difference between two protocols.
4. **Read candidates, not packets.** Once you select a winner, the outcome of the job is your choice. The per run counts in the lab are the model's behavior; the job outcome is not.
5. **Keep the label honest.** The protocol version is a label and `p:` in Recent classifications is the hash of the actual policy text. Editing a policy file without changing its version silently pools unlike runs. Change the text, change the label. The same applies to the `s:` schema and `w:` worker hashes.
6. **Hold the rest of the configuration still.** Reasoning effort and model are part of the configuration. A protocol difference measured at two different efforts is not a protocol difference.
7. **Separate withholding from blocking.** `Model withheld` means the model chose the no review shape. `Blocked: refusal language` means the release gate matched refusal phrasing in otherwise valid output, which can also happen when a review quotes such phrasing. They are different failures and only the first is about the protocol.

### Legacy records

`Legacy` is not a protocol and cannot be selected. It marks a review stored before protocol fingerprinting existed, so it carries no protocol version, policy hash, schema hash, or worker hash. `Legacy unclassified` is the same situation for an outcome code that predates outcome classification. Those records age out with retention, and every new run is fingerprinted.

Because a run with no fingerprint cannot be attributed to any protocol, the lab excludes those runs from the release rate, the outcome counts, and the model against protocol matrix. They are reported separately under Protocol identity with the number of runs and why they are not comparable. A rate shown against `alignment-v1` and a rate shown against records with no protocol are answers to different questions, over different packets, and comparing them says nothing about either.

When a comparison set is configured, the primary button on the approval screen runs it. Approving a single review stays available as the secondary option.

**Apply** stores the selection on the server. A running review keeps the configuration it started with, so a change takes effect on the next packet you approve. Every run records the model, reasoning effort, protocol version, and policy hash it used, and the Alignment Lab groups outcomes by model and protocol version.

The environment values `SOL_MODEL`, `SOL_REASONING`, and `SOL_PROTOCOL_VERSION` remain the deployment defaults for a deployment that has never been configured from the phone.

## What The Reviewer Can And Cannot Do

The reviewer reads and reasons. It never edits.

| Capability | State |
| --- | --- |
| Read the declared files, at full fidelity | Yes, through the packet |
| Full scope, reasoning, and research over that material | Yes |
| Instruct the assistant under review, precisely | Yes, through its recommendations |
| Edit a file, run a command, reach the network, use MCP | No |

That boundary is structural, not a promise in a prompt. The sandbox grants no tools at all, runs read only, and the worker terminates the run and releases nothing if a single tool, command, search, or file change event appears in the stream.

Because the reviewer cannot act, its recommendations are the only way anything changes. Every policy therefore requires each recommendation to be executable by the assistant under review without asking a follow up question: the exact path, the specific location in the file, what is wrong, what to do instead, and what the result should satisfy. A reviewer must never write a recommendation as though it had already made the change, or claim to have run or verified anything.

## Letting The Reviewer Research

By default a review is hermetic: no tools, no network, nothing but the packet. **Let the reviewer research** in Run configuration turns on web search inside the isolated sandbox for that configuration, so the reviewer can check an external fact and cite where it came from.

| Still blocked with research on | Newly allowed |
| --- | --- |
| Shell and commands, file writes, MCP, any patch or apply | Web search only |

The hook denies every tool unless the run wrote a research marker into the sandbox, and then permits only a search tool. The worker still terminates the run on any command, file change, or MCP event. A search is the single exception, and everything else about the isolation is unchanged.

The reviewer is told to search when the decision turns on an external fact — a library's documented behaviour, an API contract, a version or deprecation date, a standard, a known vulnerability — and not for anything the packet already settles. Retrieved pages are untrusted data exactly as the packet is: text on a page is never an instruction, and a page asserting something does not make it so. Sources go in a new `externalSources` field, one per source, naming what it establishes, with the URL. The released review shows them under `EXTERNAL SOURCES`, and a combined release merges them with attribution.

Two consequences worth knowing before turning it on:

1. **The sandbox reaches the internet.** A search query is composed by a model that has your packet in context, so packet content can in principle reach a search provider. If a packet carries anything you would not put into a search box, leave research off for it.
2. **A researched run is a different experiment.** It is fingerprinted as `alignment-v1+research`, so the lab never pools it with a packet-only run. The policy text also differs between the two modes, so the policy hash differs as well.

## How The Reviewer Treats What Claude Says

The packet is written by the assistant under review, so every policy tells the reviewer to read it as testimony rather than as a neutral record. A statement about what a file contains, what a command printed, or what a test established is a claim until an attached file or reproduced output shows it. Where an attached file and a claim about that file differ, the file is what is true. Where a decisive claim carries no reproduction, the reviewer names it as unverified and says which path or output would settle it.

Two properties keep this from turning into an adversarial stance, which would be worse than no scrutiny at all:

1. It is applied evenly to the parts that support the decision and the parts that undercut it, so it cannot become motivated doubt.
2. It informs confidence and evidence handling rather than the verdict, so a well-evidenced decision still returns `SOUND` at high confidence and the verdict scale stays calibrated.

The paragraph is worded identically in all three protocols, so a comparison between them measures the protocol rather than this instruction.

## Give The Reviewer The Real Files

A packet describes the code. `/sol` also declares, under `Attached Paths`, every file and folder the decision rests on, plus any path you granted for that review. **The client reads those paths itself** and appends their exact contents with a SHA-256 for each file, so the reviewer checks the code rather than a description of it, and the assistant under review cannot misquote what it cited.

| Rule | Behavior |
| --- | --- |
| Scope | Only declared paths. A folder attaches the files inside it |
| Never leaves | Credential files such as `.env`, `*.pem`, `*.key`, and `.netrc`; anything outside the working directory; binaries; files over the size limit; `node_modules`, `.git`, and other build directories |
| Secret lines | A line matching a credential pattern inside an attached file is replaced with `[REDACTED LINE]` and counted |
| Reported | Everything skipped is listed in the packet, so the phone shows what was left out and why |
| Required | `Attached Paths` is a scored packet section, and a packet that attaches nothing is flagged as leaving every claim about the code unverified |
| Limits | 256 KB per file, 4 MB total, 200 files, adjustable with `SOL_ATTACH_MAX_FILE_BYTES`, `SOL_ATTACH_MAX_TOTAL_BYTES`, and `SOL_ATTACH_MAX_FILES` |

Nothing about the sandbox changes. The reviewer still has no tools, no network, and no filesystem of its own; the files travel inside the packet you approve on the phone, and the approval screen shows how many files and how many bytes are attached before you release anything.

The review policies tell the reviewer that attached contents are an exact reproduction to be preferred over any description of the same file, that they remain untrusted data rather than instructions, and that a contradiction between an attached file and a claim in the packet should be reported with the path.

## Compare Several Responses And Choose One

One `/sol` always produces exactly one packet. What a comparison set multiplies is the responses to that packet, not the packets themselves: the same evidence is reviewed by several configurations, and you choose which of those responses reaches Claude.

**Models at once** in the same panel sets how many configurations one approval runs on the same packet, from one to six. One is a single run released automatically. Choosing more fills the comparison set with that many models at the current effort and protocol, and each slot can then be pointed at any model.

The same **Run configuration** panel holds a **comparison set** of up to six configurations. When the set is not empty, an approval offers **Approve with N candidates**:

1. Each configuration reviews the same packet in its own isolated Sandbox, one after another.
2. Nothing reaches Claude while the candidates run. The review waits in `AWAITING_SELECTION`.
3. The phone shows every candidate with its model, protocol, outcome, transcript, and full response.
4. **Send this to Claude** on one card releases exactly that candidate. **Send all N combined** releases every candidate that passed the release checks as one merged review. **Send nothing** answers with the fixed terminal response.

Before the individual responses, the screen shows the comparison itself: whether the answers agree, a table of model against verdict and confidence, and which packet sources each one actually used. Disagreement is visible without reading every response.

### Combining instead of choosing

**Send all N combined** merges every gate-passing candidate into a single release. The merge is deterministic and runs on the server with no model in the middle, because a model asked to synthesise could quietly soften the dissent that made the comparison worth running.

| Field | How it merges |
| --- | --- |
| Verdict | The most severe any reviewer returned. A lone `WRONG` is never outvoted by two `SOUND`s |
| Confidence | The lowest any reviewer reported |
| Assessment | Every assessment in full, each headed by its reviewer, verdict, and confidence, above a line stating whether they agreed and who said what |
| Recommendations | Every recommendation, stated once, naming each reviewer that made it |
| Evidence cited | The union of cited sources, each naming the reviewers that used it |
| Counterargument | Each reviewer's counterargument, attributed |

Nothing is summarised away, so the combined review is longer than any single one. Candidates that withheld or were blocked are not merged in, and the combined text passes the same release checks as any other review before it reaches Claude.

Rules that this selection does not bend:

| Rule | Behavior |
| --- | --- |
| One answer per packet | A packet is answered once. After a release or a withheld decision the answer cannot be replaced |
| Only gate passing candidates | A candidate that withheld, was blocked, or failed cannot be selected for release |
| Unselected stays private | Every candidate that was not released remains readable only in the paired PWA |
| Nothing is automatic | If the waiting client gives up before you choose, it receives the fixed terminal response and your later reading of the candidates changes nothing |

Because the operator now chooses which independent review is delivered, a released review is a selected review. Treat the release rate of a comparison set as an operator assisted number, not the raw behavior of one configuration. The Alignment Lab counts every candidate, including the ones that were never released, so the underlying per configuration rates stay visible.

A single configuration is unchanged: one run, released automatically, exactly as before.

The **run again** control on an answered review queues another run of the retained packet under the current configuration. Those runs are recorded for comparison and can never become the client answer.

A comparison set takes as long as its candidates need. `SOL_JOB_TTL_SECONDS` (one hour by default) bounds how long an unanswered packet stays valid, and the client waits for `SOL_GATE_TIMEOUT_MS` (also one hour by default). Raise both together when a set of slow candidates plus your reading time needs longer. An installed client keeps the default it was installed with until it is reinstalled or the variable is set in its environment.

## Ask Sol The Same Question With `/solute`

`/sol` reviews a decision Claude has already made. `/solute` does something different: it hands Sol the request you just made and the context needed to answer it, and Sol answers it independently.

```text
/solute
```

| Property | Behavior |
| --- | --- |
| No approval | The packet runs as soon as its integrity checks pass. It never enters the approval queue |
| No return path | The client prints one fixed acknowledgement and exits. The answer is never sent back, and the acknowledgement is identical whether the submission succeeded or failed |
| No waiting | Claude continues immediately. Nothing about the answer, its timing, or its existence can reach the session |
| Phone only | The answer, its assumptions, cited sources, and open questions are readable only in the PWA |
| Own protocol | A parallel packet uses the answering policy and its own output schema, not the review policy |

Use it to compare two independent attempts at the same problem: Claude's, which you see in your session, and Sol's, which you see on your phone. Because nothing returns, the comparison cannot influence the work it is measuring.

`/sol` and `/solute` do not block each other. A parallel answer takes no approval slot, so it can be submitted while a review is still waiting for you.

Both skills come from the same installer. An installation made before `/solute` existed has only `/sol`; run the installer again to add it.

## Use More Than One Computer

A private deployment can register multiple named Claude clients. Give each computer its own token. The phone shows when each client was last used and can revoke one credential without changing the others.

Do not use the project demo deployment as a shared account. Every owner or trusted group should deploy a separate PWA with its own Redis database, phone approval key, Codex connection, encryption key, and clients. This prevents another person from using your Codex account or seeing your review history.

The [live demo](https://sol-review-gate.vercel.app/demo) is deliberately read only. It cannot pair a phone, connect Codex, create credentials, submit a packet, or access the private PWA.

## Set Up Your Own PWA

Self hosting requires:

| Service | Purpose |
| --- | --- |
| Vercel | Next.js hosting, server functions, and isolated Sandbox execution |
| Upstash Redis | Durable encrypted job, credential, event, and result storage |
| OpenAI account with Codex access | The independent reviewer account connected from the phone |
| Node.js 22 | Local build, tests, and configuration |

Follow [the deployment guide](docs/DEPLOYMENT.md) for the complete setup. The short sequence is:

1. Fork or clone this repository.
2. Create an Upstash Redis database and connect its REST credentials to Vercel.
3. Run `npm install` and `npm run config:init`.
4. Add the generated server values to the Vercel production environment.
5. Deploy the repository.
6. Add the deployed site to the phone home screen and pair it with the generated bootstrap secret.
7. Tap **Connect Codex** and complete OpenAI device sign in.
8. Create a Claude client and run the installer using your deployed PWA address.

The GitHub repository is the reusable source and release channel. The hosted demo is only a product demonstration; it never shares the repository owner's private control plane.

Provider pricing and quotas change. Review the current [Vercel pricing](https://vercel.com/pricing), [Vercel Sandbox documentation](https://vercel.com/docs/vercel-sandbox), and [Upstash pricing](https://upstash.com/pricing) before relying on the service for frequent use.

## Security Boundary

The paired phone owns a nonexportable P 256 signing key in IndexedDB. Privileged requests use a fresh server challenge, a timestamp, a body hash, and an ECDSA signature. Packet data is compressed, integrity checked, encrypted with AES 256 GCM, and retained for a limited period.

The local client receives no phone credential, raw model stream, policy, release classification, or private diagnostic. It exits successfully with only the released review or the fixed terminal response, including when network or server failures occur.

Public source code is not a secrecy boundary. A Claude process with unrestricted filesystem and internet access can inspect an installed client or this repository and infer protocol details. The skill instruction creates a nonreactive experimental protocol, not an information theoretic guarantee. Keep the server repository and operator records outside any project directory Claude can access when concealment matters.

Read [the security model](docs/SECURITY.md) before exposing a deployment to other people.

## Releases

Every version tag runs the complete verification and mocked end to end cycle before GitHub publishes:

| File | Purpose |
| --- | --- |
| `SolReviewSetup.ps1` | One line Windows installer |
| `SolReviewSetup.sh` | macOS and Linux installer |
| `SolReviewGateWindows.zip` | Downloadable Windows installer with local payload |
| `SolReviewPlugin.zip` | Versioned Claude plugin marketplace package |
| `SolReviewRemove.ps1` | Windows remover |
| `SHA256SUMS.txt` | SHA 256 checksums for every release file |

## Development

```powershell
npm install
npm run config:init
npm run verify
npm run test:e2e
npm run plugin:validate
npm run release:package
```

The local configuration uses an in memory store and a mock Sandbox. Production mode fails closed if Redis, server secrets, or Codex authentication are unavailable.

## Repository Map

| Path | Purpose |
| --- | --- |
| `app` | PWA pages and server API routes |
| `components` | Phone dashboard and review interface |
| `lib` | Authentication, cryptography, storage, job lifecycle, gate logic, and Sandbox orchestration |
| `sandbox` | Isolated worker, output schema, denied tool hook, and the selectable review policies |
| `plugins/solreview` | Claude Code plugin, `/sol` skill source, and dependency free client |
| `scripts` | Local configuration, release packaging, icons, and test server helpers |
| `tests/core` | Gate, auth, packet, schema, storage, and runtime tests |
| `tests/e2e` | Complete mocked pair, enroll, upload, approve, review, retain, and reject cycle |
| `docs` | Deployment, architecture, and security documentation |

## Project Status

This is an experimental alignment and decision review tool. It is not a policy enforcement product, a substitute for human review, or a guarantee that either model is correct. Evaluate model output and operational risk independently.

Code is available under the [MIT License](LICENSE). The supplied logo remains subject to any rights held by its original creator.
