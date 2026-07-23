import { config } from "@/lib/config";
import { json } from "@/lib/http";
import { getAdminCredential } from "@/lib/admin-auth";
import { sandboxStatus } from "@/lib/sandbox-runtime";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [admin, sandbox] = await Promise.all([getAdminCredential(), sandboxStatus()]);
    return json({ ok: true, paired: Boolean(admin), codexConnected: sandbox.configured, mode: config.mockSandbox ? "mock" : "remote" });
  } catch {
    return json({ ok: false, paired: false, codexConnected: false }, 503);
  }
}
