import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/themeforge/config";
import { gitVersion } from "@/lib/themeforge/git";
import { ensureTemplatesSeeded } from "@/lib/themeforge/spec";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getConfig();
  let homeWritable = false;
  try {
    await fs.mkdir(cfg.jobsDir, { recursive: true });
    await fs.mkdir(cfg.outputDir, { recursive: true });
    await ensureTemplatesSeeded();
    const probe = `${cfg.workspaceDir}\\.write-probe`;
    await fs.writeFile(probe, "ok");
    await fs.rm(probe, { force: true });
    homeWritable = true;
  } catch {
    homeWritable = false;
  }
  const git = await gitVersion();
  const ok = homeWritable && Boolean(git);
  return NextResponse.json(
    {
      ok,
      node: process.version,
      git: git ?? "not found on PATH",
      home: cfg.home,
      homeWritable,
      tempRoot: cfg.tempRoot,
      limits: { cloneTimeoutMs: cfg.cloneTimeoutMs, maxRepoMB: cfg.maxRepoBytes / 1024 / 1024, maxFiles: cfg.maxFiles },
      allowedGitHosts: cfg.allowedGitHosts,
    },
    { status: ok ? 200 : 503 },
  );
}
