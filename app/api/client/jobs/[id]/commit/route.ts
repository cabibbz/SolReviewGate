import { commitJob } from "@/lib/jobs";
import { json, opaqueError } from "@/lib/http";
import { startReview } from "@/lib/sandbox-runtime";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const capability = request.headers.get("x-sol-capability") || "";
    const job = await commitJob(id, capability);
    // A parallel answer needs no approval, so it starts as soon as the packet verifies.
    if (job.kind === "parallel") await startReview(id).catch(() => undefined);
    return json({ accepted: true });
  } catch {
    return opaqueError(409);
  }
}
