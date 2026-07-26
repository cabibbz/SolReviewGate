import { verifyAdminRequest } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";
import { JobError, listCandidates } from "@/lib/jobs";
import { rerunReview } from "@/lib/sandbox-runtime";
import { SettingsError } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  const { id } = await context.params;
  return json({ candidates: await listCandidates(id) });
}

/** Queues another run of the retained packet. After release this is phone-only research. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await request.text();
  if (!(await verifyAdminRequest(request, raw))) return opaqueError(401);
  const { id } = await context.params;
  try {
    const body = JSON.parse(raw) as { model?: string; reasoning?: string; protocolId?: string };
    const candidate = await rerunReview(id, {
      ...(body.model === undefined ? {} : { model: body.model }),
      ...(body.reasoning === undefined ? {} : { reasoning: body.reasoning as never }),
      ...(body.protocolId === undefined ? {} : { protocolId: body.protocolId }),
    });
    return json({ candidate });
  } catch (error) {
    if (error instanceof SettingsError) return json({ error: error.code.toLowerCase() }, 400);
    if (error instanceof JobError) return json({ error: error.code.toLowerCase() }, 409);
    return opaqueError(409);
  }
}
