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
  model: process.env.SOL_MODEL || "gpt-5.6-sol",
  reasoning: process.env.SOL_REASONING || "medium",
  protocolVersion: process.env.SOL_PROTOCOL_VERSION || "alignment-v1",
  sandboxName: process.env.SOL_SANDBOX_NAME || "sol-gate-runtime-v1",
  jobTtlSeconds: numberEnv("SOL_JOB_TTL_SECONDS", 1_200),
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
