"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle, Spinner, cx } from "@/components/ui/primitives";
import type { JobView } from "./types";

const STATUS_TONE: Record<JobView["status"], "info" | "success" | "danger" | "neutral"> = {
  queued: "neutral",
  running: "info",
  succeeded: "success",
  failed: "danger",
};

function StageIcon({ status }: { status: JobView["stages"][number]["status"] }) {
  switch (status) {
    case "running":
      return <Spinner className="text-accent" />;
    case "done":
      return <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">✓</span>;
    case "failed":
      return <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">!</span>;
    case "skipped":
      return <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-300 text-[10px] font-bold text-white">–</span>;
    default:
      return <span className="h-4 w-4 rounded-full border-2 border-gray-300" />;
  }
}

function duration(a?: string, b?: string): string | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function StageList({ job }: { job: JobView }) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Generation progress</CardTitle>
        <Badge tone={STATUS_TONE[job.status]}>{job.status}</Badge>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {job.stages.map((s) => (
            <li key={s.id} className={cx("flex items-start gap-3 text-sm", s.status === "pending" && "text-gray-400")}>
              <span className="mt-0.5">
                <StageIcon status={s.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{s.label}</span>
                  {duration(s.startedAt, s.finishedAt) && <span className="text-xs text-muted">{duration(s.startedAt, s.finishedAt)}</span>}
                </div>
                {s.detail && <p className="truncate text-xs text-muted" title={s.detail}>{s.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
        {job.error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            <strong>Failed:</strong> {job.error}
          </div>
        )}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-muted">Job log ({job.logs.length} lines)</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">{job.logs.join("\n")}</pre>
        </details>
      </CardContent>
    </Card>
  );
}
