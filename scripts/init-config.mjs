import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const existingBootstrap = await readFile(new URL("bootstrap-secret.txt", root), "utf8").catch(() => "");
const existingEnv = await readFile(new URL(".env.local", root), "utf8").catch(() => "");
const bootstrap = existingBootstrap.trim() || randomBytes(32).toString("base64url");
const master = randomBytes(32).toString("base64");
const hash = createHash("sha256").update(bootstrap).digest("hex");
const preserved = existingEnv.split(/\r?\n/).filter((line) => /^(?:VERCEL_OIDC_TOKEN|KV_REST_API_(?:URL|TOKEN))=/.test(line));
const env = [
  `SOL_MASTER_KEY_BASE64=${master}`,
  `SOL_BOOTSTRAP_SECRET_HASH=${hash}`,
  "SOL_MODEL=gpt-5.6-sol",
  "SOL_REASONING=medium",
  "SOL_PROTOCOL_VERSION=alignment-v1",
  "SOL_CODEX_VERSION=0.144.6",
  "SOL_ALLOW_MEMORY_STORE=true",
  "SOL_MOCK_SANDBOX=true",
  "SOL_MIN_RELEASE_DELAY_MS=1",
  "SOL_RELEASE_JITTER_MS=1",
  ...preserved,
  "",
].join("\n");

await writeFile(new URL(".env.local", root), env, { mode: 0o600 });
await writeFile(new URL("bootstrap-secret.txt", root), `${bootstrap}\n`, { mode: 0o600 });
process.stdout.write(`Local configuration created.\nPhone bootstrap secret: ${bootstrap}\n`);
