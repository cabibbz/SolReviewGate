import { verifyAdminRequest } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";
import { candidateOutput, candidateRaw, getCandidate } from "@/lib/jobs";
import { candidateEvents, pollReview, readCandidateLive } from "@/lib/sandbox-runtime";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string; candidateId: string }> }) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  const { id, candidateId } = await context.params;
  await pollReview(id);
  const candidate = await getCandidate(id, candidateId);
  if (!candidate) return opaqueError();
  const [result, raw, live] = await Promise.all([
    candidateOutput(id, candidateId),
    candidateRaw(id, candidateId),
    readCandidateLive(id, candidateId),
  ]);
  const events = candidateEvents(candidate, live || "").map(({ raw: rawEvent, ...event }) => {
    void rawEvent;
    return event;
  });
  return json({ candidate, result, raw, live, events });
}
