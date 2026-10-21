import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";

export class GitError extends Error {}

interface RunResult {
  stdout: string;
  stderr: string;
}

/** Run git with execFile (argument array, no shell) and a hard timeout. */
function runGit(args: string[], cwd: string | undefined, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        cwd,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0", // never block on a credentials prompt
          GIT_SSH_COMMAND: "false", // ssh is not supported at all
          GIT_CONFIG_NOSYSTEM: "1",
          LC_ALL: "C",
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed;
          const msg = killed
            ? `git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`
            : `git ${args[0]} failed: ${sanitizeGitMessage(String(stderr || error.message))}`;
          reject(new GitError(msg));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
    child.stdin?.end();
  });
}

function sanitizeGitMessage(msg: string): string {
  return msg.replace(/https?:\/\/[^@\s]+@/g, "https://***@").trim().slice(0, 600);
}

export async function gitVersion(): Promise<string | null> {
  try {
    const { stdout } = await runGit(["--version"], undefined, 10_000);
    return stdout.trim();
  } catch {
    return null;
  }
}

export interface CloneResult {
  dir: string;
  commit: string;
  branch: string;
}

/**
 * Shallow-clone a repository into `dest`. Symlinks are disabled, hooks are
 * neutralised, and nothing from the repository is ever executed.
 */
export interface CloneOptions {
  timeoutMs?: number;
  /** Tests only: permit cloning from a local path instead of HTTPS. */
  allowLocalPath?: boolean;
}

export async function cloneRepository(cloneUrl: string, dest: string, options: CloneOptions = {}): Promise<CloneResult> {
  const timeoutMs = options.timeoutMs ?? getConfig().cloneTimeoutMs;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const args = [
    ...(options.allowLocalPath ? ["-c", "protocol.file.allow=always"] : []),
    "-c",
    "core.symlinks=false",
    "-c",
    "core.hooksPath=/nonexistent-themeforge-hooks",
    "-c",
    "core.longpaths=true",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "credential.helper=", // never pop up a credential manager dialog for private repos
    "-c",
    "protocol.allow=never",
    "-c",
    "protocol.https.allow=always",
    "clone",
    "--depth",
    "1",
    "--single-branch",
    "--no-tags",
    "--no-recurse-submodules",
    "--quiet",
    "--",
    cloneUrl,
    dest,
  ];
  await runGit(args, undefined, timeoutMs);

  const commit = (await runGit(["rev-parse", "HEAD"], dest, 15_000)).stdout.trim();
  let branch = "HEAD";
  try {
    branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], dest, 15_000)).stdout.trim();
  } catch {
    /* detached head is fine */
  }
  return { dir: dest, commit, branch };
}
