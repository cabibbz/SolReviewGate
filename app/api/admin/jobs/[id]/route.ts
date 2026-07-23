import { verifyAdminRequest } from "@/lib/admin-auth";
import { adminGetJob, adminLiveLog, adminRawOutput, adminResult, deleteJob, readPacket } from "@/lib/jobs";
import { json, opaqueError } from "@/lib/http";
import { pollReview, readLiveReview } from "@/lib/sandbox-runtime";
import { analyzePacketQuality } from "@/lib/packet-quality";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  const { id } = await context.params;
  await pollReview(id);
  const job = await adminGetJob(id);
  if (!job) return opaqueError();
  let preview: string | null = null;
  let packetQuality: ReturnType<typeof analyzePacketQuality> | null = null;
  try {
    const packet = await readPacket(job);
    preview = packet.slice(0, 200_000);
    packetQuality = analyzePacketQuality(packet);
  } catch {
    preview = null;
  }
  const [raw, result, retainedLive] = await Promise.all([adminRawOutput(id), adminResult(id), adminLiveLog(id)]);
  const live = job.state === "RUNNING" ? await readLiveReview(id) : retainedLive;
  const { clientTokenHash, ...visible } = job;
  void clientTokenHash;
  return json({ job: visible, preview, packetTruncated: Boolean(preview && Buffer.byteLength(preview, "utf8") >= 200_000), packetQuality, raw, result, live });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  const { id } = await context.params;
  try {
    await deleteJob(id);
    return json({ deleted: true });
  } catch {
    return opaqueError();
  }
}
