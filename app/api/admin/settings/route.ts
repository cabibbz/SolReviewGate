import { verifyAdminRequest } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";
import { normalizePanel, reviewSettingsView, setReviewSettings, SettingsError, type ReviewSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  return json(await reviewSettingsView());
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!(await verifyAdminRequest(request, raw))) return opaqueError(401);
  let body: Partial<ReviewSettings>;
  try {
    body = JSON.parse(raw) as Partial<ReviewSettings>;
  } catch {
    return opaqueError(400);
  }
  try {
    await setReviewSettings({
      ...(body.model === undefined ? {} : { model: body.model }),
      ...(body.reasoning === undefined ? {} : { reasoning: body.reasoning }),
      ...(body.protocolId === undefined ? {} : { protocolId: body.protocolId }),
      ...(body.panel === undefined ? {} : { panel: normalizePanel(body.panel) }),
    });
    return json(await reviewSettingsView());
  } catch (error) {
    if (error instanceof SettingsError) return json({ error: error.code.toLowerCase() }, 400);
    return opaqueError(500);
  }
}
