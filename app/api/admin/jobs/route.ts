import { verifyAdminRequest } from "@/lib/admin-auth";
import { json, opaqueError } from "@/lib/http";
import { listRecentJobs } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await verifyAdminRequest(request, ""))) return opaqueError(401);
  const jobs = await listRecentJobs();
  return json({ jobs: jobs.map(({ clientTokenHash, ...job }) => {
    void clientTokenHash;
    return job;
  }) });
}
