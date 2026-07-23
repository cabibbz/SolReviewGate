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
