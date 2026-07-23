import { verifyAdminRequest } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";
import { rejectJob } from "@/lib/jobs";
import { startReview } from "@/lib/sandbox-runtime";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await request.text();
  if (!(await verifyAdminRequest(request, raw))) return opaqueError(401);
  const { id } = await context.params;
  try {
    const body = JSON.parse(raw) as { decision?: string };
    if (body.decision === "approve") await startReview(id);
    else if (body.decision === "reject") await rejectJob(id);
    else return opaqueError(400);
    return json({ accepted: true });
  } catch {
    return opaqueError(409);
  }
}
