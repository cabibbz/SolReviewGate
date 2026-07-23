import { commitJob } from "@/lib/jobs";
import { json, opaqueError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const capability = request.headers.get("x-sol-capability") || "";
    await commitJob(id, capability);
    return json({ accepted: true });
  } catch {
    return opaqueError(409);
  }
}
