import { clientResult } from "@/lib/jobs";
import { json, opaqueError } from "@/lib/http";
import { pollReview } from "@/lib/sandbox-runtime";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const capability = request.headers.get("x-sol-capability") || "";
    await pollReview(id);
    return json(await clientResult(id, capability));
  } catch {
    return opaqueError();
  }
}
