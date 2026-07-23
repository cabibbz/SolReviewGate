<p align="center">
  <img src="public/logo.webp" width="180" alt="Sol Gate microscope logo">
</p>

<h1 align="center">Sol Review Gate</h1>

<p align="center">
  Phone approved independent Codex review for decisions made inside Claude Code.
</p>

<p align="center">
  <a href="https://sol-review-gate.vercel.app">Hosted PWA</a>
  ·
  <a href="docs/DEPLOYMENT.md">Self hosting</a>
  ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  ·
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
| Alignment lab | Separates released reviews, model withholding, wrapper blocks, worker failures, and infrastructure failures by protocol version |
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

1. Open the phone PWA.
2. Tap **Add Claude client**.
3. Copy the client token. It is shown once.
4. Open PowerShell on the computer that runs Claude Code.
5. Run:

```powershell
$env:SOL_GATE_URL='https://sol-review-gate.vercel.app'; irm 'https://raw.githubusercontent.com/cabibbz/SolReviewGate/main/install.ps1' | iex
```

6. Paste the client token into the private terminal prompt.
7. Restart Claude Code and run `/sol`.

The installer validates the PWA and token before changing files. It installs the client under `%USERPROFILE%\.sol-review`, adds a personal Claude skill at `%USERPROFILE%\.claude\skills\sol\SKILL.md`, and adds the client command to the user PATH.

To inspect the installer before running it:

```powershell
irm 'https://raw.githubusercontent.com/cabibbz/SolReviewGate/main/install.ps1'
```

### macOS And Linux

```sh
SOL_GATE_URL='https://sol-review-gate.vercel.app' sh -c "$(curl -fsSL 'https://raw.githubusercontent.com/cabibbz/SolReviewGate/main/install.sh')"
```

The shell installer uses the same private token prompt and installs `/sol` as a personal Claude skill.

### Claude Plugin Marketplace

This repository is also a Claude Code plugin marketplace:

```text
/plugin marketplace add cabibbz/SolReviewGate
/plugin install solreview@solreviewgate
/reload-plugins
```

The managed plugin exposes `/solreview:sol`. Run one of the operating system installers once to configure the PWA address and client credential. The personal installer remains the simplest path when you want the exact `/sol` command.

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

Provider pricing and quotas change. Review the current [Vercel pricing](https://vercel.com/pricing), [Vercel Sandbox documentation](https://vercel.com/docs/vercel-sandbox), and [Upstash pricing](https://upstash.com/pricing) before relying on the service for frequent use.

## Security Boundary

The paired phone owns a nonexportable P 256 signing key in IndexedDB. Privileged requests use a fresh server challenge, a timestamp, a body hash, and an ECDSA signature. Packet data is compressed, integrity checked, encrypted with AES 256 GCM, and retained for a limited period.

The local client receives no phone credential, raw model stream, policy, release classification, or private diagnostic. It exits successfully with only the released review or the fixed terminal response, including when network or server failures occur.

Public source code is not a secrecy boundary. A Claude process with unrestricted filesystem and internet access can inspect an installed client or this repository and infer protocol details. The skill instruction creates a nonreactive experimental protocol, not an information theoretic guarantee. Keep the server repository and operator records outside any project directory Claude can access when concealment matters.

Read [the security model](docs/SECURITY.md) before exposing a deployment to other people.

## Development

```powershell
npm install
npm run config:init
npm run verify
npm run test:e2e
npm run plugin:validate
```

The local configuration uses an in memory store and a mock Sandbox. Production mode fails closed if Redis, server secrets, or Codex authentication are unavailable.

## Repository Map

| Path | Purpose |
| --- | --- |
| `app` | PWA pages and server API routes |
| `components` | Phone dashboard and review interface |
| `lib` | Authentication, cryptography, storage, job lifecycle, gate logic, and Sandbox orchestration |
| `sandbox` | Isolated worker, output schema, denied tool hook, and review policy |
| `plugins/solreview` | Claude Code plugin, `/sol` skill source, and dependency free client |
| `scripts` | Local configuration, icons, and test server helpers |
| `tests/core` | Gate, auth, packet, schema, storage, and runtime tests |
| `tests/e2e` | Complete mocked pair, enroll, upload, approve, review, retain, and reject cycle |
| `docs` | Deployment, architecture, and security documentation |

## Project Status

This is an experimental alignment and decision review tool. It is not a policy enforcement product, a substitute for human review, or a guarantee that either model is correct. Evaluate model output and operational risk independently.

Code is available under the [MIT License](LICENSE). The supplied logo remains subject to any rights held by its original creator.
