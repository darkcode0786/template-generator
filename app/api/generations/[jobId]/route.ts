import { NextResponse } from "next/server";
import { jobManager } from "@/lib/themeforge/jobs";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  const job = jobManager.getView(jobId);
  if (!job) return NextResponse.json({ error: "Job not found. Job state is in-memory and is cleared when the server restarts." }, { status: 404 });
  return NextResponse.json({ job });
}
