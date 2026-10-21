"use client";

import { useState } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, cx } from "@/components/ui/primitives";
import { FolderTree } from "./FolderTree";
import { formatBytes, type PreviewPayload } from "./types";

type Tab = "tree" | "components" | "mapping" | "excluded" | "issues" | "validation";

export function ReportPanel({ preview }: { preview: PreviewPayload }) {
  const { tree, summary, manifest } = preview;
  const [tab, setTab] = useState<Tab>("tree");
  const [filter, setFilter] = useState("");

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "tree", label: "Folder tree", count: summary.files },
    { id: "components", label: "Components", count: manifest.components.length },
    { id: "mapping", label: "File mapping", count: manifest.included.length },
    { id: "excluded", label: "Excluded", count: manifest.excluded.length },
    { id: "issues", label: "Warnings & errors", count: manifest.warnings.length + manifest.errors.length + manifest.unresolvedImports.length },
    { id: "validation", label: "Validation", count: manifest.validation.checks.length },
  ];

  const f = filter.trim().toLowerCase();
  const included = f ? manifest.included.filter((x) => x.source.toLowerCase().includes(f) || x.target.toLowerCase().includes(f)) : manifest.included;
  const excluded = f ? manifest.excluded.filter((x) => x.path.toLowerCase().includes(f) || x.reason.toLowerCase().includes(f)) : manifest.excluded;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Generated theme</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-mono">{manifest.theme.key}</span>
            <span>·</span>
            <span>
              {summary.files} files, {summary.dirs} folders, {formatBytes(summary.bytes)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "rounded-md px-3 py-1.5 text-xs font-medium",
                tab === t.id ? "bg-accent text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200",
              )}
            >
              {t.label}
              {typeof t.count === "number" && <span className="ml-1 opacity-70">({t.count})</span>}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {(tab === "mapping" || tab === "excluded") && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter paths…"
            className="mb-3 w-full rounded-md border border-border px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        )}

        {tab === "tree" && (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              Output folder: <span className="font-mono">{manifest.theme.outputDir}</span>
            </p>
            <FolderTree tree={tree} />
          </div>
        )}

        {tab === "components" && (
          <div className="overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Component</th>
                  <th className="py-1 pr-3 font-medium">Section type</th>
                  <th className="py-1 pr-3 font-medium">Folder</th>
                  <th className="py-1 pr-3 font-medium">Source</th>
                  <th className="py-1 pr-3 font-medium">Editor fields</th>
                  <th className="py-1 font-medium">Default content</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {manifest.components.map((c) => (
                  <tr key={c.name}>
                    <td className="py-1.5 pr-3 font-mono font-semibold">{c.name}</td>
                    <td className="py-1.5 pr-3">{c.sectionType}</td>
                    <td className="py-1.5 pr-3">{c.folder}</td>
                    <td className="py-1.5 pr-3 font-mono text-gray-600">{c.source}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{c.editorFields.join(", ") || "—"}</td>
                    <td className="py-1.5 font-mono text-gray-600">{c.defaultContentSource ?? <span className="text-amber-700">not found</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {manifest.pages.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 text-xs font-semibold uppercase text-muted">Pages detected ({manifest.pages.length})</h3>
                <ul className="space-y-1 text-xs">
                  {manifest.pages.map((p) => (
                    <li key={p.id} className="flex flex-wrap gap-x-2">
                      <span className="font-mono font-semibold">{p.route}</span>
                      <span className="text-gray-600">{p.sections.length ? p.sections.join(" → ") : "no theme components used"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === "mapping" && (
          <div className="max-h-[480px] overflow-auto">
            {manifest.imageOptimization?.enabled && (
              <p className="mb-2 text-xs text-muted">
                Images: {manifest.imageOptimization.optimized} compressed ({manifest.imageOptimization.resized} resized), {manifest.imageOptimization.copied} kept as-is ·{" "}
                {formatBytes(manifest.imageOptimization.originalBytes)} → {formatBytes(manifest.imageOptimization.finalBytes)}
              </p>
            )}
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-card text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Source</th>
                  <th className="py-1 pr-3 font-medium">Target</th>
                  <th className="py-1 pr-3 font-medium">Kind</th>
                  <th className="py-1 pr-3 font-medium">Rule</th>
                  <th className="py-1 font-medium">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {included.map((m) => (
                  <tr key={m.target}>
                    <td className="py-1 pr-3 text-gray-600">{m.source}</td>
                    <td className="py-1 pr-3">
                      {m.target}
                      {m.renamedFrom && <Badge tone="warning" className="ml-1 font-sans">renamed</Badge>}
                    </td>
                    <td className="py-1 pr-3 font-sans">
                      <Badge>{m.kind}</Badge>
                      {m.action === "optimize" && (
                        <Badge tone="success" className="ml-1">
                          {m.resized ? "resized+compressed" : "compressed"}
                        </Badge>
                      )}
                    </td>
                    <td className="py-1 pr-3 text-gray-500">{m.rule}</td>
                    <td className="py-1 text-gray-500">
                      {m.outputSize !== undefined && m.outputSize !== m.size ? (
                        <>
                          <span className="line-through">{formatBytes(m.size)}</span> {formatBytes(m.outputSize)}
                        </>
                      ) : (
                        formatBytes(m.size)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "excluded" && (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-card text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Path</th>
                  <th className="py-1 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {excluded.map((e, i) => (
                  <tr key={`${e.path}-${i}`}>
                    <td className="py-1 pr-3 font-mono text-gray-600">{e.path}</td>
                    <td className="py-1 text-gray-700">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "issues" && (
          <div className="space-y-4 text-sm">
            {manifest.errors.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase text-red-700">Errors ({manifest.errors.length})</h3>
                <ul className="list-disc space-y-1 pl-5 text-red-700">
                  {manifest.errors.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-amber-700">Warnings ({manifest.warnings.length})</h3>
              {manifest.warnings.length === 0 ? (
                <p className="text-muted">No warnings.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-gray-800">
                  {manifest.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-muted">Unresolved imports ({manifest.unresolvedImports.length})</h3>
              {manifest.unresolvedImports.length === 0 ? (
                <p className="text-muted">All local imports were resolved or rewritten.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Component</th>
                      <th className="py-1 pr-3 font-medium">Import</th>
                      <th className="py-1 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {manifest.unresolvedImports.map((u, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-3 font-mono">{u.component}</td>
                        <td className="py-1 pr-3 font-mono">{u.specifier}</td>
                        <td className="py-1 text-gray-700">{u.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-muted">External dependencies used by components</h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(manifest.dependencies).length === 0 && <span className="text-muted">None</span>}
                {Object.entries(manifest.dependencies).map(([k, v]) => (
                  <Badge key={k} tone="info">
                    {k}@{v}
                  </Badge>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "validation" && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={manifest.validation.ok ? "success" : "danger"}>{manifest.validation.ok ? "valid" : "invalid"}</Badge>
              <span className="text-muted">
                {manifest.validation.checks.filter((c) => c.ok).length}/{manifest.validation.checks.length} checks passed
              </span>
            </div>
            <ul className="space-y-1">
              {manifest.validation.checks.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={cx("mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full", c.ok ? "bg-emerald-500" : "bg-red-500")} />
                  <span>
                    {c.name}
                    {c.detail && <span className="ml-1 text-xs text-muted">({c.detail})</span>}
                  </span>
                </li>
              ))}
            </ul>
            {manifest.validation.issues.length > 0 && (
              <ul className="space-y-1 border-t border-border pt-3 text-xs">
                {manifest.validation.issues.map((i, idx) => (
                  <li key={idx} className={i.level === "error" ? "text-red-700" : "text-amber-700"}>
                    [{i.code}] {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
