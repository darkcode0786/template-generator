import fs from "node:fs/promises";
import path from "node:path";
import { aliasesFromTsconfig } from "./analysis";
import { getConfig } from "./config";
import { cloneRepository } from "./git";
import { formatSavings, optimizeImage, writePreviewWebp } from "./images";
import { buildMappingPlan } from "./mapper";
import { isInside, pascalCase, safeJoin, slugify, timestampKey, titleCase } from "./paths";
import { scanRepository } from "./scanner";
import { loadSpec, type ThemeSpec } from "./spec";
import { buildThemeVariables, formatRootVarsCss, mergeCssVariables } from "./cssvars";
import { normalizeThemePages } from "./themePages";
import { assetTargetMap, transformComponent } from "./transform";
import { buildTree } from "./tree";
import type { ComponentPlan, MappingPlan, ScanResult, ThemeManifest, TreeNode, UnresolvedImport, ValidationReport } from "./types";
import { validateOutput } from "./validator";
import { assertPublicHost, validateRepoUrl, type GenerationInput } from "./validation";
import { zipDirectory } from "./zip";

export const STAGES = [
  { id: "validate", label: "Validate input" },
  { id: "clone", label: "Clone repository" },
  { id: "spec", label: "Load theme specification" },
  { id: "scan", label: "Scan files" },
  { id: "detect", label: "Detect framework" },
  { id: "map", label: "Map source to target" },
  { id: "copy", label: "Copy and transform files" },
  { id: "manifest", label: "Write theme.json and manifest" },
  { id: "validate-output", label: "Validate generated theme" },
  { id: "zip", label: "Create ZIP archive" },
  { id: "cleanup", label: "Clean up temporary files" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export interface GenerationHooks {
  onStage: (stage: StageId, status: "running" | "done" | "failed" | "skipped", detail?: string) => void;
  onLog?: (line: string) => void;
}

export interface GenerationResult {
  outputDir: string;
  zipPath: string;
  zipBytes: number;
  manifest: ThemeManifest;
  tree: TreeNode;
  project: ScanResult["project"];
}

export interface GenerateOptions {
  /** Skip cloning and use this already-present local directory (tests only). */
  localRepoDir?: string;
  /** Override the loaded spec (tests only). */
  spec?: ThemeSpec;
  /** Override output root (tests only). */
  outputRoot?: string;
  /** Override temp root (tests only). */
  tempRoot?: string;
}

async function rmrf(p: string, mustBeInside: string[]): Promise<void> {
  if (!mustBeInside.some((root) => isInside(root, p)) || mustBeInside.some((root) => path.resolve(root) === path.resolve(p))) {
    throw new Error(`Refusing to delete ${p}: outside managed directories`);
  }
  await fs.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** JSON that is never component content: PWA manifests, i18n bundles, editor settings, fixtures. */
const NON_CONTENT_JSON = /(^|\/)(public|static|locales?|i18n|messages|\.vscode|\.idea|__tests__|__mocks__|fixtures?|coverage)\//i;

/**
 * Load every content JSON file in the repository. `sources.dataDirs` is a *preference*, not a
 * filter: files there are read first (so they win ties in default-content matching), but data kept
 * next to the components (e.g. `components/data/data.json`) is picked up as well.
 */
async function readDataFiles(repoDir: string, scan: ScanResult, spec: ThemeSpec): Promise<{ path: string; json: unknown }[]> {
  const out: { path: string; json: unknown }[] = [];
  const inDataDir = (p: string) => spec.sources.dataDirs.some((d) => p.startsWith(`${d}/`));
  const candidates = scan.files
    .filter((f) => f.ext === ".json" && f.category === "data" && f.size < 5 * 1024 * 1024 && !NON_CONTENT_JSON.test(f.path))
    .sort((a, b) => Number(inDataDir(b.path)) - Number(inDataDir(a.path)) || a.path.localeCompare(b.path));
  for (const f of candidates) {
    try {
      out.push({ path: f.path, json: JSON.parse(await fs.readFile(path.join(repoDir, f.path), "utf8")) });
    } catch {
      /* invalid JSON data is simply not used */
    }
  }
  return out;
}

/**
 * Collect `:root` custom properties from the repository's stylesheets. `globals.css`-style
 * entry files are read first so their definitions win over partial/module stylesheets.
 */
async function collectCssVars(repoDir: string, scan: ScanResult): Promise<Record<string, string>> {
  const rank = (p: string) => (/(^|\/)globals?\.(css|scss)$/i.test(p) ? 0 : /(^|\/)(app|src\/app|styles|src\/styles)\//i.test(p) ? 1 : 2);
  const sheets = scan.files
    .filter((f) => f.category === "style" && [".css", ".scss"].includes(f.ext) && f.size < 2 * 1024 * 1024 && !/\.module\./i.test(f.path))
    .sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  const contents: string[] = [];
  for (const f of sheets) {
    try {
      contents.push(await fs.readFile(path.join(repoDir, f.path), "utf8"));
    } catch {
      /* unreadable stylesheet: skip */
    }
  }
  return mergeCssVariables(contents);
}

function pickPreviewImage(plan: MappingPlan, spec: ThemeSpec): string | undefined {
  const images = plan.files.filter((f) => f.kind === "image").map((f) => f.target);
  for (const pref of spec.themeJson.previewImagePreference) {
    const hit = images.find((t) => t.toLowerCase().includes(pref.toLowerCase()));
    if (hit) return hit;
  }
  return images[0];
}

export async function runGeneration(jobId: string, input: GenerationInput, hooks: GenerationHooks, opts: GenerateOptions = {}): Promise<GenerationResult> {
  const cfg = getConfig();
  const log = (l: string) => hooks.onLog?.(l);
  const outputRoot = opts.outputRoot ?? cfg.outputDir;
  const tempRoot = opts.tempRoot ?? cfg.tempRoot;
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. validate -------------------------------------------------------------
  hooks.onStage("validate", "running");
  const repo = validateRepoUrl(input.repoUrl);
  if (!opts.localRepoDir) await assertPublicHost(repo.host);
  const categorySlug = slugify(input.category);
  const templateSlug = slugify(input.template);
  const templatePascal = pascalCase(input.template);
  const outputDir = safeJoin(safeJoin(outputRoot, categorySlug), templateSlug);
  hooks.onStage("validate", "done", `${repo.owner}/${repo.repo} -> ${categorySlug}/${templateSlug}`);

  // 2. clone ----------------------------------------------------------------
  const jobTemp = path.join(tempRoot, jobId);
  const repoDir = opts.localRepoDir ?? path.join(jobTemp, "repo");
  let commit = "local";
  let branch = "local";
  try {
    hooks.onStage("clone", "running", repo.cloneUrl);
    if (opts.localRepoDir) {
      hooks.onStage("clone", "skipped", "using local repository directory");
    } else {
      await fs.mkdir(jobTemp, { recursive: true });
      const c = await cloneRepository(repo.cloneUrl, repoDir);
      commit = c.commit;
      branch = c.branch;
      hooks.onStage("clone", "done", `${branch}@${commit.slice(0, 7)}`);
    }

    // 3/4. scan + detect ---------------------------------------------------
    hooks.onStage("spec", "running");
    const spec = opts.spec ?? (await loadSpec(input.specId));
    hooks.onStage("spec", "done", `${spec.name} v${spec.version}`);

    hooks.onStage("scan", "running");
    const scan = await scanRepository(repoDir, spec);
    warnings.push(...scan.warnings);
    hooks.onStage("scan", "done", `${scan.files.length} files, ${scan.excluded.length} excluded`);

    hooks.onStage("detect", "running");
    const p = scan.project;
    hooks.onStage("detect", "done", `${p.framework}${p.frameworkVersion ? ` ${p.frameworkVersion}` : ""} · ${p.languages.join(", ") || "n/a"}`);

    // 6. map -----------------------------------------------------------------
    hooks.onStage("map", "running");
    const plan = await buildMappingPlan({ repoDir, templatePascal, spec, scan });
    warnings.push(...plan.warnings);
    hooks.onStage("map", "done", `${plan.files.length} files, ${plan.components.length} components, ${plan.pages.length} pages`);

    // 7. copy ----------------------------------------------------------------
    hooks.onStage("copy", "running");
    await prepareOutputDir(outputDir, outputRoot, spec, warnings);
    for (const dir of spec.requiredDirectories) await fs.mkdir(safeJoin(outputDir, dir), { recursive: true });

    const fileSet = new Set(scan.files.map((f) => f.path));
    const hasSrc = scan.files.some((f) => f.path.startsWith("src/"));
    const tsconfig = await fs
      .readFile(path.join(repoDir, "tsconfig.json"), "utf8")
      .then((raw) => JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>)
      .catch(() => null);
    const aliases = aliasesFromTsconfig(tsconfig, hasSrc);
    const componentBySource = new Map(plan.components.map((c) => [c.source, c]));
    const assetTargets = assetTargetMap(plan.files);
    const sources = new Map<string, string>();
    for (const f of scan.files) {
      if (![".ts", ".tsx"].includes(f.ext) || f.size > 400_000) continue;
      sources.set(f.path, await fs.readFile(path.join(repoDir, f.path), "utf8").catch(() => ""));
    }
    const dataFiles = await readDataFiles(repoDir, scan, spec);
    const sourceVars = await collectCssVars(repoDir, scan);
    let colorCorpus = "";
    for (const component of plan.components) {
      colorCorpus += await fs.readFile(path.join(repoDir, component.source), "utf8").catch(() => "");
    }
    const themeColors = buildThemeVariables(sourceVars, colorCorpus);
    const cssVars = themeColors.injected;
    if (spec.transformations.injectCssVars.enabled && Object.keys(sourceVars).length === 0 && themeColors.rewrites.length === 0) {
      warnings.push("No brand colours found in the repository; Theme Color variables use the standard defaults.");
    }

    const unresolvedImports: UnresolvedImport[] = [];
    const dependencies: Record<string, string> = {};
    const componentDetails: ThemeManifest["components"] = [];
    const imgStats: ThemeManifest["imageOptimization"] = { enabled: spec.assets.optimizeImages.enabled, optimized: 0, copied: 0, resized: 0, originalBytes: 0, finalBytes: 0 };
    let copied = 0;

    for (const pf of plan.files) {
      const src = safeJoin(repoDir, pf.source);
      const dest = safeJoin(outputDir, pf.target);
      const st = await fs.lstat(src);
      if (!st.isFile()) {
        warnings.push(`Skipped ${pf.source}: not a regular file.`);
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      if (pf.action === "transform" && pf.kind === "component") {
        const component = componentBySource.get(pf.source) as ComponentPlan;
        const source = await fs.readFile(src, "utf8");
        const result = transformComponent({ spec, component, source, aliases, fileSet, componentBySource, assetTargets, dataFiles, packageDeps: p.dependencies, cssVars, colorRewrites: themeColors.rewrites, colorVarRewrites: themeColors.varRewrites, sources });
        await fs.writeFile(dest, result.code, "utf8");
        await fs.writeFile(safeJoin(outputDir, `${component.targetDir}/component.json`), JSON.stringify(result.componentJson, null, 2) + "\n", "utf8");
        unresolvedImports.push(...result.unresolvedImports);
        Object.assign(dependencies, result.dependencies);
        warnings.push(...result.warnings);
        componentDetails.push({ ...component, editorFields: result.editorFields, defaultContentSource: result.defaultContentSource, fieldRenames: result.fieldRenames });
      } else if (pf.kind === "image") {
        const r = await optimizeImage(src, dest, spec.assets.optimizeImages);
        imgStats.originalBytes += r.originalBytes;
        imgStats.finalBytes += r.finalBytes;
        if (r.action === "optimized") {
          imgStats.optimized += 1;
          if (r.resized) imgStats.resized += 1;
          pf.action = "optimize";
          pf.outputSize = r.finalBytes;
          pf.resized = r.resized;
        } else {
          imgStats.copied += 1;
          pf.outputSize = r.finalBytes;
          if (r.reason?.startsWith("decode/encode failed")) warnings.push(`Image ${pf.source} copied unchanged: ${r.reason}.`);
        }
      } else {
        await fs.copyFile(src, dest);
      }
      copied += 1;
    }
    for (const u of unresolvedImports) {
      warnings.push(`Unresolved import in ${u.component}: "${u.specifier}" (${u.reason}).`);
    }
    // styles/variables.css: the collected :root variables in one readable place (the same set is inlined in every component).
    const hasStylesDir = spec.optionalDirectories.includes("styles") || plan.files.some((f) => f.target.startsWith("styles/"));
    if (hasStylesDir && Object.keys(themeColors.variables).length) {
      const varsDest = safeJoin(outputDir, "styles/variables.css");
      await fs.mkdir(path.dirname(varsDest), { recursive: true });
      await fs.writeFile(varsDest, formatRootVarsCss(themeColors.variables), "utf8");
      copied += 1;
    }
    const imgSummary = imgStats.enabled && imgStats.optimized + imgStats.copied > 0 ? `; images ${formatSavings(imgStats.originalBytes, imgStats.finalBytes)}` : "";
    hooks.onStage("copy", "done", `${copied} files written${imgSummary}`);

    const previewImage = await materializePreview(outputDir, pickPreviewImage(plan, spec));

    // 8. theme.json + addons + manifest ---------------------------------------
    hooks.onStage("manifest", "running");
    const key = `${templateSlug}-${timestampKey()}`;
    const themeJson = buildThemeJson({ key, input, categorySlug, repo: repo.cloneUrl, plan, spec, variables: themeColors.variables, previewImage });
    await fs.writeFile(path.join(outputDir, "theme.json"), JSON.stringify(themeJson, null, 2) + "\n", "utf8");
    for (const [file, content] of Object.entries(spec.themeJson.addons)) {
      const dest = safeJoin(outputDir, `addons/${file}`);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, JSON.stringify(content, null, 2) + "\n", "utf8");
    }
    const zipPath = path.join(path.dirname(outputDir), `${path.basename(outputDir)}.zip`);
    const manifest: ThemeManifest = {
      generator: { name: "ThemeForge", version: "0.1.0", generatedAt: new Date().toISOString(), spec: spec.name, specVersion: spec.version },
      input: { repoUrl: input.repoUrl, category: input.category, categorySlug, template: input.template, templateSlug },
      source: { cloneUrl: repo.cloneUrl, commit, branch, project: p },
      theme: { key, outputDir, zipFile: zipPath },
      included: plan.files,
      excluded: [...scan.excluded, ...plan.skipped],
      components: componentDetails,
      pages: plan.pages,
      dependencies,
      unresolvedImports,
      imageOptimization: imgStats,
      cssVariables: themeColors.variables,
      warnings,
      errors,
      validation: { ok: false, checks: [], issues: [] },
    };
    hooks.onStage("manifest", "done", key);

    // 9. validate output -----------------------------------------------------
    hooks.onStage("validate-output", "running");
    // write a provisional manifest first so validation sees the final file set
    await fs.writeFile(path.join(outputDir, "theme-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    const validation: ValidationReport = await validateOutput(outputDir, spec);
    manifest.validation = validation;
    for (const i of validation.issues) {
      if (i.level === "error") errors.push(i.message);
    }
    await fs.writeFile(path.join(outputDir, "theme-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    hooks.onStage("validate-output", validation.ok ? "done" : "failed", `${validation.checks.filter((c) => c.ok).length}/${validation.checks.length} checks passed`);
    if (!validation.ok) {
      throw new Error(`Generated theme failed validation: ${errors.join(" | ")}`);
    }

    // 10. zip ------------------------------------------------------------------
    hooks.onStage("zip", "running");
    const { bytes } = await zipDirectory(outputDir, zipPath);
    hooks.onStage("zip", "done", `${(bytes / 1024 / 1024).toFixed(2)} MB`);

    const tree = await buildTree(outputDir);
    log(`Theme written to ${outputDir}`);
    return { outputDir, zipPath, zipBytes: bytes, manifest, tree, project: p };
  } finally {
    // 12. cleanup --------------------------------------------------------------
    hooks.onStage("cleanup", "running");
    if (!opts.localRepoDir) {
      try {
        // Bounded: a locked file on Windows must not leave the job "running" forever.
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          rmrf(jobTemp, [tempRoot]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("timed out after 60s (file still in use?)")), 60_000);
          }),
        ]).finally(() => clearTimeout(timer));
        hooks.onStage("cleanup", "done", "temporary clone removed");
      } catch (e) {
        hooks.onStage("cleanup", "failed", `could not remove ${jobTemp}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      hooks.onStage("cleanup", "skipped", "local repository kept");
    }
  }
}

async function prepareOutputDir(outputDir: string, outputRoot: string, spec: ThemeSpec, warnings: string[]): Promise<void> {
  if (!isInside(outputRoot, outputDir)) throw new Error("Output directory escapes the managed output root.");
  let exists = false;
  try {
    await fs.access(outputDir);
    exists = true;
  } catch {
    /* fresh */
  }
  if (exists) {
    switch (spec.conflicts.existingOutputPolicy) {
      case "error":
        throw new Error(`Output folder already exists: ${outputDir} (existingOutputPolicy = error).`);
      case "version": {
        let n = 2;
        let candidate = `${outputDir}-${n}`;
        while (
          await fs
            .access(candidate)
            .then(() => true)
            .catch(() => false)
        ) {
          n += 1;
          candidate = `${outputDir}-${n}`;
        }
        throw new Error(`Output folder exists; "version" policy would write to ${candidate}. Rename the template or use the "replace" policy.`);
      }
      case "replace":
      default:
        warnings.push(`Replaced existing output folder ${outputDir} (existingOutputPolicy = replace).`);
        await rmrf(outputDir, [outputRoot]);
    }
  }
  await fs.mkdir(outputDir, { recursive: true });
}

/** Copy the chosen preview onto `assets/preview.webp`, the path the template card reads. */
async function materializePreview(outputDir: string, sourceRel: string | undefined): Promise<string> {
  if (!sourceRel) return "";
  const destRel = "assets/preview.webp";
  const src = safeJoin(outputDir, sourceRel);
  const dest = safeJoin(outputDir, destRel);
  if (src === dest) return destRel;
  if (await writePreviewWebp(src, dest)) return destRel;
  const ext = path.extname(sourceRel).toLowerCase() || ".webp";
  const fallback = `assets/preview${ext === ".jpeg" ? ".jpg" : ext}`;
  if (fallback !== sourceRel) {
    await fs.mkdir(path.dirname(safeJoin(outputDir, fallback)), { recursive: true });
    await fs.copyFile(src, safeJoin(outputDir, fallback));
  }
  return fallback;
}

function buildThemeJson(args: { key: string; input: GenerationInput; categorySlug: string; repo: string; plan: MappingPlan; spec: ThemeSpec; variables: Record<string, string>; previewImage?: string }) {
  const { key, input, categorySlug, repo, plan, spec, variables, previewImage } = args;
  const sectionVariants: Record<string, string> = {};
  for (const c of plan.components) {
    if (!sectionVariants[c.sectionType]) sectionVariants[c.sectionType] = c.name;
  }
  const normalized = normalizeThemePages(
    plan.pages.filter((p) => p.sections.length > 0).map((p) => ({ id: p.id, label: p.label, sectionType: p.sectionType, sections: p.sections })),
    sectionVariants,
  );
  const homeSectionOrder = normalized.homeSectionOrder;
  const pages = normalized.pages;
  return {
    key,
    title: titleCase(input.template),
    type: pages.length > 1 ? spec.themeJson.multiPageType : spec.themeJson.singlePageType,
    categorySlug,
    category: input.category,
    previewImage: previewImage || pickPreviewImage(plan, spec) || "",
    previewDescription: `Generated by ThemeForge from ${repo}`,
    homeSectionOrder,
    sectionVariants,
    variables,
    pages,
  };
}
