"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Spinner } from "@/components/ui/primitives";
import type { TemplateOption } from "./types";

export interface FormValues {
  repoUrl: string;
  category: string;
  template: string;
  specId: string;
}

interface Props {
  templates: TemplateOption[];
  allowedHosts: string[];
  busy: boolean;
  onSubmit: (values: FormValues) => Promise<{ ok: true } | { ok: false; error: string; issues?: { path: string; message: string }[] }>;
}

export function GenerationForm({ templates, allowedHosts, busy, onSubmit }: Props) {
  const [values, setValues] = useState<FormValues>({ repoUrl: "", category: "", template: "", specId: templates[0]?.id ?? "default-theme" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setFieldErrors((f) => ({ ...f, [k]: "" }));
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const res = await onSubmit(values);
    if (!res.ok) {
      setError(res.error);
      const fe: Record<string, string> = {};
      for (const i of res.issues ?? []) fe[i.path] = i.message;
      setFieldErrors(fe);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New theme</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="repoUrl">Git repository URL</Label>
            <Input
              id="repoUrl"
              name="repoUrl"
              type="url"
              required
              placeholder="https://github.com/owner/repository"
              value={values.repoUrl}
              onChange={set("repoUrl")}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-muted">HTTPS only. Allowed hosts: {allowedHosts.join(", ")}.</p>
            {fieldErrors.repoUrl && <p className="mt-1 text-xs text-red-600">{fieldErrors.repoUrl}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="category">Category name</Label>
              <Input id="category" name="category" required placeholder="Repairing & Maintenance" value={values.category} onChange={set("category")} disabled={busy} />
              {fieldErrors.category && <p className="mt-1 text-xs text-red-600">{fieldErrors.category}</p>}
            </div>
            <div>
              <Label htmlFor="template">Template name</Label>
              <Input id="template" name="template" required placeholder="computer-repairing" value={values.template} onChange={set("template")} disabled={busy} />
              {fieldErrors.template && <p className="mt-1 text-xs text-red-600">{fieldErrors.template}</p>}
            </div>
          </div>
          <div>
            <Label htmlFor="specId">Theme specification</Label>
            <select
              id="specId"
              name="specId"
              value={values.specId}
              onChange={set("specId")}
              disabled={busy}
              className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              {templates.length === 0 && <option value="default-theme">default-theme</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id} disabled={!t.valid}>
                  {t.name} (v{t.version}){!t.valid ? " — invalid JSON" : ""}
                </option>
              ))}
            </select>
            {templates.find((t) => t.id === values.specId)?.description && (
              <p className="mt-1 text-xs text-muted">{templates.find((t) => t.id === values.specId)?.description}</p>
            )}
          </div>
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />}
              {busy ? "Generating…" : "Generate Theme"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
