# PWA Deployment

This guide creates an independent Sol Review Gate deployment. Each deployment has one paired phone administrator, one isolated Codex connection, and any number of separately revocable Claude Code clients.

The public page at `/demo` is read only sample data. It is safe to share. The root PWA is the private control plane and should be used only by its paired owner.

## Requirements

1. A Vercel account with access to Vercel Sandbox
2. An Upstash Redis database with its REST API enabled
3. An OpenAI account that can use Codex
4. Node.js 22 or newer
5. Git and the Vercel CLI

## Create The Project

1. Fork `cabibbz/SolReviewGate` on GitHub.
2. Import the fork as a new Vercel project.
3. Keep the framework preset as Next.js.
4. Do not deploy until the required environment variables are present.

## Connect Redis

Use either naming scheme:

| Upstash names | Vercel integration names |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | `KV_REST_API_URL` |
| `UPSTASH_REDIS_REST_TOKEN` | `KV_REST_API_TOKEN` |

The application accepts either pair. Apply the values to Production, Preview, and Development if every environment should use the same database. Use separate databases when test data must remain isolated.

## Generate Server Secrets

From a local clone:

```powershell
npm install
npm run config:init
```

This creates two ignored files:

| File | Contents |
| --- | --- |
| `.env.local` | Local server configuration and generated cryptographic values |
| `bootstrap-secret.txt` | The one time value used to pair the first phone |

Add these values from `.env.local` to the Vercel production environment:

```text
SOL_MASTER_KEY_BASE64
SOL_BOOTSTRAP_SECRET_HASH
SOL_MODEL
SOL_REASONING
```

Recommended production values:

```text
SOL_PUBLIC_URL=https://yourdomain.example
SOL_MODEL=gpt-5.6-sol
SOL_REASONING=medium
SOL_PROTOCOL_VERSION=alignment-v1
SOL_MODEL_CHOICES=
SOL_CODEX_VERSION=0.144.6
SOL_JOB_TTL_SECONDS=14400
SOL_RESULT_TTL_SECONDS=604800
SOL_MAX_PACKET_BYTES=8388608
```

`SOL_MODEL`, `SOL_REASONING`, and `SOL_PROTOCOL_VERSION` are only the starting values. Once the phone changes the model, reasoning effort, or alignment protocol under **Lab** and **Run configuration**, the stored selection wins and these variables no longer control new reviews. `SOL_MODEL_CHOICES` is an optional comma separated list of extra model ids offered in that picker; any other id your Codex account can use may still be entered directly.

Do not enable these local test switches in production:

```text
SOL_ALLOW_MEMORY_STORE
SOL_MOCK_SANDBOX
SOL_MIN_RELEASE_DELAY_MS
SOL_RELEASE_JITTER_MS
```

`SOL_MASTER_KEY_BASE64` encrypts retained data. Rotating it makes existing encrypted records unreadable. Preserve it in a secure recovery system.

## Deploy

Production can be deployed three ways. The first two need no local clone, which matters when the server repository is kept off every machine that runs Claude Code.

### From GitHub, with the Vercel Git integration

In the Vercel project, open **Settings**, **Git**, connect `cabibbz/SolReviewGate`, and set the production branch to `main`. Every merge to `main` then builds and deploys itself. Nothing else is required.

### From GitHub Actions

Use this when the project should stay disconnected from Git. Add three repository secrets under **Settings**, **Secrets and variables**, **Actions**:

| Secret | Where it comes from |
| --- | --- |
| `VERCEL_TOKEN` | Vercel account settings, Tokens |
| `VERCEL_ORG_ID` | Vercel project settings, General |
| `VERCEL_PROJECT_ID` | Vercel project settings, General |

The `Deploy` workflow then verifies and deploys production on every push to `main`, and can be run on demand from the Actions tab. Without those secrets the workflow reports what is missing and stops rather than failing.

### From a local clone

```powershell
vercel deploy --prod
```

`--prod` matters. Without it the CLI publishes a preview URL and production keeps serving the previous build. Confirm the clone is linked to the intended project first with `cat .vercel/project.json`, because an unlinked directory creates a new project under a different address.

## Confirm What Is Running

`/api/health` reports the running build:

```text
https://yourdomain.example/api/health
```

The `build` field carries the deployed commit. A response with no `build` field predates this feature, which means the deployment is older than it looks. A healthy unpaired deployment also returns `ok` set to `true`.

## Install The PWA And Pair The Phone

1. Open the HTTPS deployment in the phone browser.
2. Add it to the phone home screen.
3. Open the installed PWA.
4. Enter the value from `bootstrap-secret.txt`.
5. Complete pairing.

Pairing writes a nonexportable signing key to the installed PWA storage. A different browser profile cannot administer the deployment.

## Connect Codex

1. Tap **Connect Codex**.
2. Tap **Open OpenAI sign in**.
3. Enter the displayed one time code.
4. Return to the PWA.
5. Wait until the dashboard reports **Connected**.

The server creates a temporary Sandbox, installs the configured Codex CLI version, completes device sign in, validates the generated authentication file, and saves a short lived Sandbox snapshot. The connection expires after 29 days by design, then the PWA asks for device sign in again.

## Enroll Claude Code

1. Tap **Claude clients** in the PWA.
2. Enter a recognizable computer or person name.
3. Tap **Create client token**.
4. Copy the token shown once.
5. Run the installer command shown by the PWA on the Claude Code computer.
6. Enter the token at the private prompt.
7. Restart Claude Code.
8. Run `/sol`.

The installer calls `/api/client/verify` before writing the credential, so an incorrect PWA address or token fails before installation.

Repeat these steps for every Claude computer. Do not reuse one token across people. The client manager records recent use and can revoke one client without affecting any other active client.

## Public Demo And Private Use

The hosted demonstration at `https://sol-review-gate.vercel.app/demo` has no registration or account connection capability. It is not a public review service.

Every person who wants a private working PWA should deploy their own copy. A deployment owns:

1. One phone signing key
2. One Codex authentication snapshot
3. One Redis namespace and encrypted review history
4. One master encryption key
5. Its own named Claude client credentials

Running a shared public service would require user accounts, tenant level data isolation, usage billing, abuse controls, and separate Codex authorization for every tenant. Those boundaries are intentionally not simulated by this single administrator design.

## Retention And Recovery

The Storage view applies a 1 to 30 day retention period to completed reviews. Pending jobs have a shorter operational lifetime.

Losing the only paired phone requires operator access to Redis and Vercel:

1. Delete the Redis key `sol:admin:credential`.
2. Generate a new bootstrap secret.
3. Replace `SOL_BOOTSTRAP_SECRET_HASH`.
4. redeploy.
5. Pair the replacement phone.

There is intentionally no unauthenticated recovery endpoint.

## Production Checklist

1. Redis uses production credentials.
2. Memory store and mock Sandbox are disabled.
3. The master key is backed up securely.
4. The bootstrap secret is not committed or sent through chat.
5. The PWA is installed before pairing.
6. Codex reports Connected.
7. The client verification endpoint accepts the newly enrolled token.
8. A complete review cycle passes from `/sol` through phone approval to a released result.
9. Review retention matches the operator policy.
10. Vercel and Upstash usage alerts are configured for the expected workload.
