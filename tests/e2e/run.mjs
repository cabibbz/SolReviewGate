import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const port = 32_000 + Math.floor(Math.random() * 1_000);
const baseUrl = `http://127.0.0.1:${port}`;
const bootstrap = "solreviewgate e2e bootstrap secret";
const serverEnv = {
  ...process.env,
  SOL_ALLOW_MEMORY_STORE: "true",
  SOL_MOCK_SANDBOX: "true",
  SOL_MASTER_KEY_BASE64: Buffer.alloc(32, 9).toString("base64"),
  SOL_BOOTSTRAP_SECRET_HASH: createHash("sha256").update(bootstrap).digest("hex"),
  SOL_MIN_RELEASE_DELAY_MS: "1",
  SOL_RELEASE_JITTER_MS: "1",
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  KV_REST_API_URL: "",
  KV_REST_API_TOKEN: "",
};
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: process.cwd(),
  env: serverEnv,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let logs = "";
server.stdout.on("data", (chunk) => { logs += chunk; });
server.stderr.on("data", (chunk) => { logs += chunk; });

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited early\n${logs}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server start timed out\n${logs}`);
}

try {
  await waitForServer();
  const test = spawn(process.execPath, ["tests/e2e/mock-cycle.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, SOL_E2E_URL: baseUrl, SOL_E2E_BOOTSTRAP: bootstrap },
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise((resolve, reject) => {
    test.on("error", reject);
    test.on("close", resolve);
  });
  if (code !== 0) throw new Error(`E2E cycle exited ${code}\n${logs}`);
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}
