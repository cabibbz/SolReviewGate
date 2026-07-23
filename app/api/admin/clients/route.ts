import { verifyAdminRequest } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";
import { registerClient } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  if (!(await verifyAdminRequest(request, raw))) return opaqueError(401);
  try {
    const body = JSON.parse(raw) as { name?: string };
    const result = await registerClient(body.name || "Claude Code");
    return json({ clientId: result.client.id, token: result.token });
  } catch {
    return opaqueError(400);
  }
}
