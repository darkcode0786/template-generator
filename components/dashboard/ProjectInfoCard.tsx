"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import type { ProjectInfo } from "@/lib/themeforge/types";
import { formatBytes } from "./types";

export function ProjectInfoCard({ project }: { project: ProjectInfo }) {
  const counts = Object.entries(project.counts).filter(([, n]) => n > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Detected project</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[120px_1fr] gap-y-1.5">
          <dt className="text-muted">Framework</dt>
          <dd className="font-medium">
            {project.framework}
            {project.frameworkVersion && <span className="ml-1 text-muted">{project.frameworkVersion}</span>}
            {project.hasAppRouter && <Badge tone="info" className="ml-2">App Router</Badge>}
            {project.hasPagesRouter && <Badge tone="info" className="ml-2">Pages Router</Badge>}
          </dd>
          <dt className="text-muted">Languages</dt>
          <dd>{project.languages.join(", ") || "—"}</dd>
          <dt className="text-muted">Styling</dt>
          <dd>{project.styling.join(", ") || "—"}</dd>
          <dt className="text-muted">Package</dt>
          <dd>
            {project.packageName ?? "—"}
            {project.packageManager && <span className="ml-1 text-muted">({project.packageManager})</span>}
          </dd>
          <dt className="text-muted">Source roots</dt>
          <dd className="font-mono text-xs">{project.sourceRoots.join("  ") || "—"}</dd>
          <dt className="text-muted">Size</dt>
          <dd>
            {project.totalFiles} files · {formatBytes(project.totalBytes)}
          </dd>
        </dl>
        <div className="flex flex-wrap gap-1.5">
          {counts.map(([k, n]) => (
            <Badge key={k}>
              {k}: {n}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
