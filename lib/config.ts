const isProduction = process.env.NODE_ENV === "production";

function numberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}`);
  }
  return Math.floor(parsed);
}

export const config = {
  isProduction,
  // Identifies the running build so the PWA can show which deployment it is talking to.
  // NEXT_PUBLIC_SOL_BUILD is inlined at build time, so it survives a deployment that carries
  // no git metadata. The other two are read at run time when they are present.
  build: (process.env.NEXT_PUBLIC_SOL_BUILD || process.env.SOL_BUILD || process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "local",
  model: process.env.SOL_MODEL || "gpt-5.6-sol",
  reasoning: process.env.SOL_REASONING || "medium",
  protocolVersion: process.env.SOL_PROTOCOL_VERSION || "alignment-v1",
  sandboxName: process.env.SOL_SANDBOX_NAME || "sol-gate-runtime-v1",
  // A comparison set runs one candidate at a time and then waits for an operator selection,
  // so an unanswered packet stays valid far longer than a single run needs.
  // Four hours: a comparison set of slow candidates plus the operator actually reading them. An
  // expired packet silently answers the client with the terminal response, so the default errs long.
  jobTtlSeconds: numberEnv("SOL_JOB_TTL_SECONDS", 14_400),
  resultTtlSeconds: numberEnv("SOL_RESULT_TTL_SECONDS", 7 * 24 * 60 * 60),
  maxPacketBytes: numberEnv("SOL_MAX_PACKET_BYTES", 8 * 1024 * 1024),
  maxChunkBytes: 512 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
  minReleaseDelayMs: numberEnv("SOL_MIN_RELEASE_DELAY_MS", isProduction ? 30_000 : 1),
  releaseJitterMs: numberEnv("SOL_RELEASE_JITTER_MS", isProduction ? 15_000 : 1),
  memoryStoreAllowed: process.env.SOL_ALLOW_MEMORY_STORE === "true" || !isProduction,
  mockSandbox: process.env.SOL_MOCK_SANDBOX === "true",
};

export function requireServerSecret(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (!isProduction && name === "SOL_MASTER_KEY_BASE64") {
      return Buffer.alloc(32, 7).toString("base64");
    }
    throw new Error(`Missing server configuration: ${name}`);
  }
  return value;
}
