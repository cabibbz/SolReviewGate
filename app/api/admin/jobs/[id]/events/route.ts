import { verifyAdminRequest } from "@/lib/admin-auth";
import { adminJobEvents } from "@/lib/jobs";
import { json, opaqueError } from "@/lib/http";
import { pollReview } from "@/lib/sandbox-runtime";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  const { id } = await context.params;
  await pollReview(id);
  const cursor = Math.max(0, Number(new URL(request.url).searchParams.get("cursor") || 0) || 0);
  const events = await adminJobEvents(id);
  return json({ events: events.slice(cursor).map(({ raw, ...event }) => {
    void raw;
    return event;
  }), cursor: events.length });
}
