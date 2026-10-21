import { NextResponse } from "next/server";
import { jobManager } from "@/lib/themeforge/jobs";
import { generationInputSchema, RepoUrlError, validateRepoUrl } from "@/lib/themeforge/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: jobManager.list() });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = generationInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input.", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  try {
    validateRepoUrl(parsed.data.repoUrl); // fail fast, before a job is created
  } catch (err) {
    if (err instanceof RepoUrlError) {
      return NextResponse.json({ error: err.message, issues: [{ path: "repoUrl", message: err.message }] }, { status: 400 });
    }
    throw err;
  }
  try {
    const job = jobManager.create(parsed.data);
    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 429 });
  }
}
