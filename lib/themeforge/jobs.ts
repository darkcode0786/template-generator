import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";
import { runGeneration, STAGES, type GenerationResult, type StageId } from "./generator";
import type { GenerationInput } from "./validation";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface JobStage {
  id: StageId;
  label: string;
  status: StageStatus;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  input: GenerationInput;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  stages: JobStage[];
  logs: string[];
  error?: string;
  result?: GenerationResult;
}

/** Public, JSON-safe view (no absolute temp paths leak beyond what the UI needs). */
export interface JobView {
  id: string;
  status: JobStatus;
  input: GenerationInput;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  stages: JobStage[];
  logs: string[];
  error?: string;
  project?: GenerationResult["project"];
  output?: { outputDir: string; zipPath: string; zipBytes: number; themeKey: string; warnings: number; errors: number };
}

/**
 * In-memory job manager. Restarting `npm run dev` clears all job state; the
 * generated folders/ZIPs on disk remain, and a job.json snapshot is written
 * under <home>/workspace/jobs/<id>/ for reference.
 */
interface JobStore {
  jobs: Map<string, JobRecord>;
  running: number;
}

class JobManager {
  private readonly maxConcurrent = 2;
  private readonly maxJobsKept = 50;

  constructor(private readonly store: JobStore) {}

  private get jobs() {
    return this.store.jobs;
  }
  private get running() {
    return this.store.running;
  }
  private set running(n: number) {
    this.store.running = n;
  }

  list(): JobView[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toView);
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  getView(id: string): JobView | undefined {
    const j = this.jobs.get(id);
    return j ? toView(j) : undefined;
  }

  create(input: GenerationInput): JobView {
    if (this.running >= this.maxConcurrent) {
      throw new Error(`Too many jobs running (${this.running}). Wait for one to finish.`);
    }
    const id = randomUUID();
    const job: JobRecord = {
      id,
      status: "queued",
      input,
      createdAt: new Date().toISOString(),
      stages: STAGES.map((s) => ({ id: s.id, label: s.label, status: "pending" })),
      logs: [],
    };
    this.jobs.set(id, job);
    this.prune();
    void this.execute(job);
    return toView(job);
  }

  private prune() {
    const finished = [...this.jobs.values()].filter((j) => j.status === "succeeded" || j.status === "failed").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    while (this.jobs.size > this.maxJobsKept && finished.length) {
      const victim = finished.shift()!;
      this.jobs.delete(victim.id);
    }
  }

  private async execute(job: JobRecord) {
    this.running += 1;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    const log = (line: string) => {
      job.logs.push(`[${new Date().toISOString()}] ${line}`);
      if (job.logs.length > 500) job.logs.shift();
    };
    try {
      job.result = await runGeneration(job.id, job.input, {
        onLog: log,
        onStage: (id, status, detail) => {
          const stage = job.stages.find((s) => s.id === id);
          if (!stage) return;
          stage.status = status;
          if (detail) stage.detail = detail;
          if (status === "running") stage.startedAt = new Date().toISOString();
          else stage.finishedAt = new Date().toISOString();
          log(`${stage.label}: ${status}${detail ? ` — ${detail}` : ""}`);
        },
      });
      job.status = "succeeded";
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      const running = job.stages.find((s) => s.status === "running");
      if (running) running.status = "failed";
      log(`FAILED: ${job.error}`);
    } finally {
      job.finishedAt = new Date().toISOString();
      this.running -= 1;
      await persistSnapshot(job).catch(() => undefined);
    }
  }
}

function toView(j: JobRecord): JobView {
  return {
    id: j.id,
    status: j.status,
    input: j.input,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    stages: j.stages,
    logs: j.logs,
    error: j.error,
    project: j.result?.project,
    output: j.result
      ? {
          outputDir: j.result.outputDir,
          zipPath: j.result.zipPath,
          zipBytes: j.result.zipBytes,
          themeKey: j.result.manifest.theme.key,
          warnings: j.result.manifest.warnings.length,
          errors: j.result.manifest.errors.length,
        }
      : undefined,
  };
}

async function persistSnapshot(job: JobRecord) {
  const cfg = getConfig();
  const dir = path.join(cfg.jobsDir, job.id);
  await fs.mkdir(dir, { recursive: true });
  const { result, ...rest } = job;
  await fs.writeFile(
    path.join(dir, "job.json"),
    JSON.stringify({ ...rest, output: result ? { outputDir: result.outputDir, zipPath: result.zipPath } : undefined }, null, 2),
    "utf8",
  );
}

// Survive Next.js dev hot-reloads by stashing only the job *state* on globalThis.
// The manager (and therefore the generator code it calls) is recreated on every
// module load, so edits to the pipeline take effect without a server restart.
const g = globalThis as unknown as { __themeforgeJobStore?: JobStore };
const store: JobStore = g.__themeforgeJobStore ?? (g.__themeforgeJobStore = { jobs: new Map(), running: 0 });
export const jobManager = new JobManager(store);
