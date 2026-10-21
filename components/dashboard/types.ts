import type { JobView } from "@/lib/themeforge/jobs";
import type { ThemeManifest, TreeNode } from "@/lib/themeforge/types";

export type { JobView };

export interface PreviewPayload {
  tree: TreeNode;
  summary: { files: number; dirs: number; bytes: number };
  manifest: ThemeManifest;
}

export interface TemplateOption {
  id: string;
  name: string;
  description?: string;
  version: number;
  valid: boolean;
  error?: string;
}

export interface HealthPayload {
  ok: boolean;
  node: string;
  git: string;
  home: string;
  homeWritable: boolean;
  tempRoot: string;
  allowedGitHosts: string[];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
