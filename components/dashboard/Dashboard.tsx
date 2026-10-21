"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardContent } from "@/components/ui/primitives";
import { GenerationForm, type FormValues } from "./GenerationForm";
import { ProjectInfoCard } from "./ProjectInfoCard";
import { ReportPanel } from "./ReportPanel";
import { StageList } from "./StageList";
import type { HealthPayload, JobView, PreviewPayload, TemplateOption } from "./types";
import { formatBytes } from "./types";

const POLL_MS = 1000;

export function Dashboard() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [job, setJob] = useState<JobView | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]));
  }, []);

  const stopPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  const loadPreview = useCallback(async (jobId: string) => {
    try {
      const r = await fetch(`/api/generations/${jobId}/preview`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Preview failed (${r.status})`);
      setPreview(d);
      setPreviewError(null);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const poll = useCallback(
    async (jobId: string) => {
      try {
        const r = await fetch(`/api/generations/${jobId}`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `Status request failed (${r.status})`);
        }
        const { job: j } = (await r.json()) as { job: JobView };
        setJob(j);
        if (j.status === "succeeded") {
          stopPolling();
          await loadPreview(jobId);
          return;
        }
        if (j.status === "failed") {
          stopPolling();
          return;
        }
        pollRef.current = setTimeout(() => void poll(jobId), POLL_MS);
      } catch (e) {
        stopPolling();
        setJob((prev) => (prev ? { ...prev, status: "failed", error: e instanceof Error ? e.message : String(e) } : prev));
      }
    },
    [loadPreview],
  );

  useEffect(() => () => stopPolling(), []);

  async function startGeneration(values: FormValues) {
    setPreview(null);
    setPreviewError(null);
    const r = await fetch("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false as const, error: d.error || `Request failed (${r.status})`, issues: d.issues };
    setJob(d.job as JobView);
    pollRef.current = setTimeout(() => void poll(d.job.id), 300);
    return { ok: true as const };
  }

  function reset() {
    stopPolling();
    setJob(null);
    setPreview(null);
    setPreviewError(null);
  }

  const busy = job?.status === "queued" || job?.status === "running";

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ThemeForge</h1>
          <p className="text-sm text-muted">Turn a public Git repository into a structured theme folder. Everything runs on this machine.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {health ? (
            <>
              <Badge tone={health.ok ? "success" : "danger"}>{health.ok ? "local server healthy" : "setup problem"}</Badge>
              <span className="text-muted" title={`Git: ${health.git}`}>
                home <span className="font-mono">{health.home}</span>
              </span>
            </>
          ) : (
            <Badge>checking health…</Badge>
          )}
        </div>
      </header>

      {health && !health.ok && (
        <Card className="mb-6 border-red-200">
          <CardContent className="text-sm text-red-700">
            {!health.homeWritable && <p>The workspace directory {health.home} is not writable. Set THEMEFORGE_HOME in .env.local to a writable folder.</p>}
            {health.git.startsWith("not found") && <p>Git was not found on PATH. Install Git for Windows and restart the dev server.</p>}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {!job && <GenerationForm templates={templates} allowedHosts={health?.allowedGitHosts ?? []} busy={false} onSubmit={startGeneration} />}
          {job && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-[90px_1fr] gap-y-1">
                  <span className="text-muted">Repository</span>
                  <span className="truncate font-mono text-xs" title={job.input.repoUrl}>
                    {job.input.repoUrl}
                  </span>
                  <span className="text-muted">Category</span>
                  <span>{job.input.category}</span>
                  <span className="text-muted">Template</span>
                  <span>{job.input.template}</span>
                  <span className="text-muted">Job</span>
                  <span className="font-mono text-xs">{job.id}</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  {job.status === "succeeded" && job.output && (
                    <a
                      href={`/api/generations/${job.id}/download`}
                      className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      download
                    >
                      Download ZIP ({formatBytes(job.output.zipBytes)})
                    </a>
                  )}
                  <Button variant="secondary" onClick={reset} disabled={busy}>
                    Generate Another Theme
                  </Button>
                </div>
                {job.status === "succeeded" && job.output && (
                  <p className="pt-1 text-xs text-muted">
                    Saved to <span className="font-mono">{job.output.outputDir}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {job && <StageList job={job} />}
          {job?.project && <ProjectInfoCard project={job.project} />}
        </div>

        <div className="space-y-6">
          {!job && (
            <Card>
              <CardContent className="space-y-3 text-sm text-gray-700">
                <h2 className="font-semibold">How it works</h2>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>The repository is shallow-cloned into a temporary folder with Git. No scripts from the repository are ever executed.</li>
                  <li>Files are scanned and classified; secrets, dependencies, build output and archives are excluded.</li>
                  <li>
                    The selected theme specification maps components to <span className="font-mono">components/&lt;Name&gt;/</span>, images to{" "}
                    <span className="font-mono">assets/&lt;group&gt;/</span>, and writes <span className="font-mono">theme.json</span> plus a manifest.
                  </li>
                  <li>The result is validated, zipped, and the temporary clone is deleted.</li>
                </ol>
                <p className="text-xs text-muted">
                  Job status lives in memory: restarting the dev server clears it. Generated folders and ZIPs stay on disk under the output directory.
                </p>
              </CardContent>
            </Card>
          )}
          {previewError && (
            <Card className="border-amber-200">
              <CardContent className="text-sm text-amber-800">{previewError}</CardContent>
            </Card>
          )}
          {preview && <ReportPanel preview={preview} />}
        </div>
      </div>
    </div>
  );
}
