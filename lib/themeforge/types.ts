import type { MappingKind } from "./spec";

export type FileCategory =
  | "component"
  | "page"
  | "layout"
  | "style"
  | "image"
  | "icon"
  | "font"
  | "data"
  | "config"
  | "script"
  | "type"
  | "doc"
  | "media"
  | "other";

export interface ScannedFile {
  /** POSIX path relative to repository root. */
  path: string;
  size: number;
  ext: string;
  category: FileCategory;
}

export interface ExcludedFile {
  path: string;
  reason: string;
}

export interface ProjectInfo {
  framework: string;
  frameworkVersion?: string;
  languages: string[];
  styling: string[];
  packageManager?: string;
  packageName?: string;
  sourceRoots: string[];
  hasAppRouter: boolean;
  hasPagesRouter: boolean;
  dependencies: Record<string, string>;
  counts: Record<FileCategory, number>;
  totalFiles: number;
  totalBytes: number;
}

export interface ScanResult {
  files: ScannedFile[];
  excluded: ExcludedFile[];
  project: ProjectInfo;
  warnings: string[];
}

export interface PlannedFile {
  source: string;
  target: string;
  kind: MappingKind;
  rule: string;
  size: number;
  action: "copy" | "transform" | "optimize";
  renamedFrom?: string;
  /** Bytes written to the output (differs from `size` when an image was compressed). */
  outputSize?: number;
  resized?: boolean;
}

export interface ComponentPlan {
  source: string;
  baseName: string;
  sectionType: string;
  sectionNumber: number;
  name: string;
  folder: string;
  scope: string;
  targetDir: string;
  targetFile: string;
}

export interface PagePlan {
  id: string;
  label: string;
  sectionType: string;
  route: string;
  source: string;
  sections: string[];
  unresolvedComponents: string[];
}

export interface MappingPlan {
  files: PlannedFile[];
  components: ComponentPlan[];
  pages: PagePlan[];
  skipped: ExcludedFile[];
  warnings: string[];
}

export interface UnresolvedImport {
  component: string;
  specifier: string;
  reason: string;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}

export interface ValidationReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
  issues: ValidationIssue[];
}

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  children?: TreeNode[];
}

export interface ThemeManifest {
  generator: { name: string; version: string; generatedAt: string; spec: string; specVersion: number };
  input: { repoUrl: string; category: string; categorySlug: string; template: string; templateSlug: string };
  source: { cloneUrl: string; commit: string; branch: string; project: ProjectInfo };
  theme: { key: string; outputDir: string; zipFile: string };
  included: PlannedFile[];
  excluded: ExcludedFile[];
  components: (ComponentPlan & { editorFields: string[]; defaultContentSource?: string; fieldRenames?: { from: string; to: string; occurrences: number }[] })[];
  pages: PagePlan[];
  dependencies: Record<string, string>;
  unresolvedImports: UnresolvedImport[];
  imageOptimization: { enabled: boolean; optimized: number; copied: number; resized: number; originalBytes: number; finalBytes: number };
  /** `:root` custom properties inlined into every component (reference `theme-upload-css-vars`). */
  cssVariables: Record<string, string>;
  warnings: string[];
  errors: string[];
  validation: ValidationReport;
}
