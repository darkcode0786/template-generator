import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneRepository, GitError, gitVersion } from "@/lib/themeforge/git";
import { makeTempDir, writeFiles } from "./helpers";

const run = promisify(execFile);
let work: string;
let sourceRepo: string;

beforeAll(async () => {
  work = await makeTempDir("themeforge-git-");
  sourceRepo = path.join(work, "source");
  await fs.mkdir(sourceRepo);
  await writeFiles(sourceRepo, { "README.md": "# fixture\n", "components/A.tsx": "export const A = () => null;\n" });
  const git = (args: string[]) => run("git", args, { cwd: sourceRepo });
  await git(["init", "-q", "-b", "main"]);
  await git(["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "."]);
  await git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
});
afterAll(() => fs.rm(work, { recursive: true, force: true }));

describe("git", () => {
  it("reports the git version", async () => {
    expect(await gitVersion()).toMatch(/^git version/);
  });

  it("clones a local repository shallowly (test-only local mode)", async () => {
    const dest = path.join(work, "clone");
    const r = await cloneRepository(sourceRepo, dest, { allowLocalPath: true });
    expect(r.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(r.branch).toBe("main");
    await expect(fs.access(path.join(dest, "components", "A.tsx"))).resolves.toBeUndefined();
  });

  it("refuses local paths by default (protocol allow-list)", async () => {
    const dest = path.join(work, "clone-denied");
    await expect(cloneRepository(sourceRepo, dest)).rejects.toThrow(GitError);
  });

  it("fails fast on a missing repository instead of hanging", async () => {
    const dest = path.join(work, "clone-missing");
    await expect(cloneRepository(path.join(work, "does-not-exist"), dest, { allowLocalPath: true, timeoutMs: 20_000 })).rejects.toThrow(GitError);
  });
});
