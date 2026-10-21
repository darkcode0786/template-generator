import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/themeforge/config";
import { jobManager } from "@/lib/themeforge/jobs";
import { isInside } from "@/lib/themeforge/paths";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Streams the ZIP that belongs to a job. The path comes from the job record,
 * never from the request, and must live under the managed output directory.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  const job = jobManager.get(jobId);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "succeeded" || !job.result) {
    return NextResponse.json({ error: `Job is ${job.status}; nothing to download yet.` }, { status: 409 });
  }
  const zipPath = job.result.zipPath;
  if (!isInside(getConfig().outputDir, zipPath)) {
    return NextResponse.json({ error: "ZIP path is outside the managed output directory." }, { status: 500 });
  }
  let size: number;
  try {
    size = (await fs.stat(zipPath)).size;
  } catch {
    return NextResponse.json({ error: "ZIP file no longer exists on disk." }, { status: 410 });
  }
  const filename = path.basename(zipPath).replace(/[^A-Za-z0-9._-]/g, "_");
  const stream = Readable.toWeb(createReadStream(zipPath)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
