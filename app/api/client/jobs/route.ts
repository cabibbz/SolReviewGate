import { authenticateClient, createJob } from "@/lib/jobs";
import { json, opaqueError, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const client = await authenticateClient(token);
    if (!client) return opaqueError(401);
    const body = await readJson<{ packetHash: string; compressedHash: string; compressedBytes: number; chunkCount: number }>(request, 32_000);
    const { job, capability } = await createJob(client, body);
    return json({ jobId: job.id, capability, maxChunkBytes: 512 * 1024, expiresAt: job.expiresAt });
  } catch {
    return opaqueError(409);
  }
}
