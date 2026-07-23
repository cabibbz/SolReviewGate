import { issueChallenge } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  try {
    return json(await issueChallenge());
  } catch {
    return opaqueError(503);
  }
}
