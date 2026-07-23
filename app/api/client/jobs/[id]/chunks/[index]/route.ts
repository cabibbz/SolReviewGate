import { opaqueError, json, readJson } from "@/lib/http";
import { uploadChunk } from "@/lib/jobs";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string; index: string }> }) {
  try {
    const { id, index } = await context.params;
    const capability = request.headers.get("x-sol-capability") || "";
    const body = await readJson<{ data: string }>(request, 900_000);
    await uploadChunk(id, capability, Number(index), body.data || "");
    return json({ accepted: true });
  } catch {
    return opaqueError(409);
  }
}
