import os from "node:os";
import path from "node:path";

/**
 * All ThemeForge data lives under one configurable root (THEMEFORGE_HOME).
 * Layout:
 *   <home>/workspace/jobs/<jobId>/job.json     job records + logs
 *   <home>/output/<category>/<template>/       generated theme folder
 *   <home>/output/<category>/<template>.zip    downloadable archive
 *   <home>/templates/*.json                    editable theme specifications
 * Cloning happens in the OS temp dir: <tmp>/themeforge/<jobId>/repo
 */
function defaultHome(): string {
  if (process.platform === "win32") {
    const drive = process.env.SystemDrive || "C:";
    return path.join(`${drive}\\`, "ThemeForge");
  }
  return path.join(os.homedir(), "ThemeForge");
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getConfig() {
  const home = path.resolve(process.env.THEMEFORGE_HOME || defaultHome());
  return {
    home,
    workspaceDir: path.join(home, "workspace"),
    jobsDir: path.join(home, "workspace", "jobs"),
    outputDir: path.join(home, "output"),
    templatesDir: path.join(home, "templates"),
    tempRoot: path.join(os.tmpdir(), "themeforge"),
    /** Bundled spec files that get seeded into <home>/templates on first run. */
    bundledTemplatesDir: path.join(process.cwd(), "templates"),
    cloneTimeoutMs: intEnv("THEMEFORGE_CLONE_TIMEOUT_MS", 120_000),
    maxRepoBytes: intEnv("THEMEFORGE_MAX_REPO_MB", 200) * 1024 * 1024,
    maxFiles: intEnv("THEMEFORGE_MAX_FILES", 5000),
    /** Hosts that may be cloned from. HTTPS only. */
    allowedGitHosts: [
      "github.com",
      "gitlab.com",
      "bitbucket.org",
      "codeberg.org",
      "gitea.com",
      "git.sr.ht",
    ],
  };
}

export type AppConfig = ReturnType<typeof getConfig>;
