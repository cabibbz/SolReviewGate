import { verifyAdminRequest } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";
import { revokeClient } from "@/lib/jobs";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  const { id } = await params;
  const client = await revokeClient(id);
  if (!client) return opaqueError(404);
  return json({ revoked: true });
}
