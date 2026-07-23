import { authenticateClient } from "@/lib/jobs";
import { json, opaqueError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const client = await authenticateClient(token);
  if (!client) return opaqueError(401);
  return json({ ok: true, client: client.name });
}
