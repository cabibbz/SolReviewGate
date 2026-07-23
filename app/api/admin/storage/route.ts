import { verifyAdminRequest } from "@/lib/admin-auth";
import { setRetentionDays, storageSummary } from "@/lib/jobs";
import { json, opaqueError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  return json(await storageSummary());
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!(await verifyAdminRequest(request, raw))) return opaqueError(401);
  try {
    const body = JSON.parse(raw) as { retentionDays?: number };
    await setRetentionDays(Number(body.retentionDays));
    return json(await storageSummary());
  } catch {
    return opaqueError(400);
  }
}
