import { verifyAdminRequest } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";
import { pollDeviceLogin, startDeviceLogin } from "@/lib/sandbox-runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  return json(await pollDeviceLogin());
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!(await verifyAdminRequest(request, raw))) return opaqueError(401);
  try {
    await startDeviceLogin();
    return json({ started: true });
  } catch {
    return opaqueError(409);
  }
}
