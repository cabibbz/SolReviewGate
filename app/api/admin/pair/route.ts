import { PairingError, pairAdmin } from "@/lib/admin-auth";
import { json, opaqueError, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ secret: string; publicKey: JsonWebKey }>(request, 32_000);
    const credential = await pairAdmin(body.secret || "", body.publicKey || {});
    return json({ credentialId: credential.id });
  } catch (error) {
    if (error instanceof PairingError) {
      const status = error.code === "ALREADY_PAIRED" ? 409 : error.code === "INVALID_KEY" ? 400 : 401;
      return json({ error: error.code.toLowerCase() }, status);
    }
    return opaqueError(401);
  }
}
