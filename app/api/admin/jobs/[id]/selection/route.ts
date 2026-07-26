import { verifyAdminRequest } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";
import { JobError, releaseCandidate } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await request.text();
  if (!(await verifyAdminRequest(request, raw))) return opaqueError(401);
  const { id } = await context.params;
  try {
    const body = JSON.parse(raw) as { candidateId?: string | null };
    const job = await releaseCandidate(id, body.candidateId || null);
    return json({ released: job.state === "COMPLETE_REVIEW", state: job.state, selectedCandidateId: job.selectedCandidateId || null });
  } catch (error) {
    if (error instanceof JobError) return json({ error: error.code.toLowerCase() }, 409);
    return opaqueError(409);
  }
}
