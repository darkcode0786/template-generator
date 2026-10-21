import { NextResponse } from "next/server";
import { jobManager } from "@/lib/themeforge/jobs";
import { countTree } from "@/lib/themeforge/tree";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  const job = jobManager.get(jobId);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "succeeded" || !job.result) {
    return NextResponse.json({ error: `Job is ${job.status}; preview is available once it succeeds.`, status: job.status }, { status: 409 });
  }
  const { tree, manifest } = job.result;
  return NextResponse.json({
    tree,
    summary: countTree(tree),
    manifest,
  });
}
