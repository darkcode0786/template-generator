import fs from "node:fs/promises";
import path from "node:path";
import { isInside, isSafeRelativePath } from "./paths";
import type { ThemeSpec } from "./spec";
import type { ValidationIssue, ValidationReport } from "./types";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listAll(root: string): Promise<{ rel: string; abs: string; isDir: boolean; isSymlink: boolean; size: number }[]> {
  const out: { rel: string; abs: string; isDir: boolean; isSymlink: boolean; size: number }[] = [];
  async function walk(dir: string, rel: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = await fs.lstat(abs);
      out.push({ rel: r, abs, isDir: e.isDirectory(), isSymlink: st.isSymbolicLink(), size: st.size });
      if (e.isDirectory() && !st.isSymbolicLink()) await walk(abs, r);
    }
  }
  await walk(root, "");
  return out;
}

/** Validate the generated theme directory against the spec. */
export async function validateOutput(outputDir: string, spec: ThemeSpec): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const checks: ValidationReport["checks"] = [];
  const err = (code: string, message: string, p?: string) => issues.push({ level: "error", code, message, path: p });
  const warn = (code: string, message: string, p?: string) => issues.push({ level: "warning", code, message, path: p });

  const entries = await listAll(outputDir);
  const realRoot = await fs.realpath(outputDir);

  // Required directories
  for (const dir of spec.requiredDirectories) {
    const ok = await exists(path.join(outputDir, dir));
    checks.push({ name: `required directory: ${dir}`, ok });
    if (!ok) err("MISSING_DIR", `Required directory "${dir}" is missing.`, dir);
  }
  // Required files
  for (const f of spec.requiredFiles) {
    const ok = await exists(path.join(outputDir, f));
    checks.push({ name: `required file: ${f}`, ok });
    if (!ok) err("MISSING_FILE", `Required file "${f}" is missing.`, f);
  }

  // Path safety, symlinks, forbidden extensions, size
  let unsafe = 0;
  let symlinks = 0;
  let forbidden = 0;
  for (const e of entries) {
    if (!isSafeRelativePath(e.rel)) {
      unsafe += 1;
      err("UNSAFE_PATH", `Unsafe path in output: ${e.rel}`, e.rel);
    }
    if (e.isSymlink) {
      symlinks += 1;
      err("SYMLINK", `Symlink found in output: ${e.rel}`, e.rel);
    } else {
      const real = await fs.realpath(e.abs).catch(() => e.abs);
      if (!isInside(realRoot, real)) {
        unsafe += 1;
        err("ESCAPE", `Entry resolves outside the output directory: ${e.rel}`, e.rel);
      }
    }
    if (!e.isDir) {
      const ext = path.posix.extname(e.rel).toLowerCase();
      if (spec.validation.forbiddenExtensions.map((x) => x.toLowerCase()).includes(ext)) {
        forbidden += 1;
        err("FORBIDDEN_EXT", `Forbidden file type in output: ${e.rel}`, e.rel);
      }
      if (e.size > spec.validation.maxFileSizeMB * 1024 * 1024) warn("LARGE_FILE", `File larger than ${spec.validation.maxFileSizeMB} MB: ${e.rel}`, e.rel);
    }
  }
  checks.push({ name: "all paths are traversal-free", ok: unsafe === 0 });
  checks.push({ name: "no symlinks", ok: symlinks === 0 });
  checks.push({ name: "no forbidden file types", ok: forbidden === 0 });

  // theme.json
  let theme: Record<string, unknown> | null = null;
  try {
    theme = JSON.parse(await fs.readFile(path.join(outputDir, "theme.json"), "utf8"));
    checks.push({ name: "theme.json parses", ok: true });
  } catch (e) {
    checks.push({ name: "theme.json parses", ok: false, detail: String(e) });
    err("THEME_JSON", "theme.json is missing or invalid JSON.", "theme.json");
  }

  // Components: each dir has <Name>.tsx|jsx + component.json; sectionVariants resolve
  const componentDirs = entries.filter((e) => e.isDir && /^components\/[^/]+$/.test(e.rel));
  let badComponents = 0;
  let contractViolations = 0;
  let editorFitIssues = 0;
  for (const d of componentDirs) {
    const name = path.posix.basename(d.rel);
    const hasTsx = (await exists(path.join(d.abs, `${name}.tsx`))) || (await exists(path.join(d.abs, `${name}.jsx`)));
    const hasJson = await exists(path.join(d.abs, "component.json"));
    if (!hasTsx || !hasJson) {
      badComponents += 1;
      err("COMPONENT_SHAPE", `components/${name} must contain ${name}.tsx and component.json.`, d.rel);
      continue;
    }
    try {
      const cj = JSON.parse(await fs.readFile(path.join(d.abs, "component.json"), "utf8"));
      if (cj.key !== name || cj.name !== name) warn("COMPONENT_KEY", `component.json key/name does not match folder "${name}".`, `${d.rel}/component.json`);
      // Host contract (matches the reference theme): editorFields non-empty, defaultContent non-empty,
      // and every editor field present as a defaultContent key.
      const fields: string[] = Array.isArray(cj.editorFields) ? cj.editorFields : [];
      const content = cj.defaultContent && typeof cj.defaultContent === "object" ? (cj.defaultContent as Record<string, unknown>) : {};
      const missing = fields.filter((f) => !(f in content));
      if (!fields.length) {
        contractViolations += 1;
        err("EDITOR_FIELDS_EMPTY", `components/${name}: editorFields is empty.`, `${d.rel}/component.json`);
      }
      if (!Object.keys(content).length) {
        contractViolations += 1;
        err("DEFAULT_CONTENT_EMPTY", `components/${name}: defaultContent is empty.`, `${d.rel}/component.json`);
      }
      if (missing.length) {
        contractViolations += 1;
        err("DEFAULT_CONTENT_KEYS", `components/${name}: defaultContent missing keys: ${missing.join(", ")}.`, `${d.rel}/component.json`);
      }
      // Host editor fit (apps/frontend EditSectionModal): these do not block the upload, but they
      // decide whether the section editor can actually show and edit the fields.
      const hostTypes = spec.naming.hostSectionTypes;
      if (hostTypes.length && typeof cj.sectionType === "string" && !hostTypes.includes(cj.sectionType)) {
        editorFitIssues += 1;
        warn("HOST_SECTION_TYPE", `components/${name}: sectionType "${cj.sectionType}" is not a host section type; the editor will treat it generically. Add an alias in naming.sectionTypeAliases.`, `${d.rel}/component.json`);
      }
      const hollow = fields.filter((f) => {
        const v = content[f];
        return (Array.isArray(v) && v.length === 0) || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
      });
      if (hollow.length) {
        editorFitIssues += 1;
        warn("HOLLOW_FIELD", `components/${name}: ${hollow.join(", ")} ${hollow.length > 1 ? "are" : "is"} an empty object/list; the editor renders no controls for it and cannot add items.`, `${d.rel}/component.json`);
      }
      const imageKeyUnrecognised = Object.entries(content).filter(([k, v]) => {
        if (typeof v !== "string" || !/\.(jpe?g|png|webp|avif|gif|svg)$/i.test(v)) return false;
        const key = k.toLowerCase().replace(/\d+$/, "");
        if (/title|alt|label|href/.test(key)) return true;
        return !(key === "image" || key.endsWith("image") || key === "poster" || /^(imagemain|imagesmall|avatar|logo)$/.test(key));
      }).map(([k]) => k);
      if (imageKeyUnrecognised.length) {
        warn("IMAGE_KEY_NAME", `components/${name}: ${imageKeyUnrecognised.join(", ")} hold image paths but the editor only shows an image picker for keys named "image"/"…Image"; they will be plain text inputs.`, `${d.rel}/component.json`);
      }
      if (Array.isArray(content.items) && !["FeaturedDev", "InvestmentOpportunities", "Awards"].includes(String(cj.sectionType))) {
        warn("ITEMS_NOT_ADDABLE", `components/${name}: the host editor does not allow adding to a collection named "items" for ${cj.sectionType}; users can edit but not add entries.`, `${d.rel}/component.json`);
      }
    } catch {
      badComponents += 1;
      err("COMPONENT_JSON", `components/${name}/component.json is not valid JSON.`, `${d.rel}/component.json`);
    }
  }
  checks.push({ name: `component folders well-formed (${componentDirs.length})`, ok: badComponents === 0 });
  checks.push({ name: "editorFields ⊆ defaultContent keys (host contract)", ok: contractViolations === 0 });
  checks.push({ name: "section types known to host editor, no hollow fields", ok: editorFitIssues === 0, detail: editorFitIssues ? `${editorFitIssues} warning(s)` : undefined });
  if (spec.validation.requireAtLeastOneComponent) {
    checks.push({ name: "at least one component", ok: componentDirs.length > 0 });
    if (!componentDirs.length) err("NO_COMPONENTS", "The generated theme contains no components.");
  }

  if (theme) {
    const variants = (theme.sectionVariants || {}) as Record<string, string>;
    const dirNames = new Set(componentDirs.map((d) => path.posix.basename(d.rel)));
    let missingVariants = 0;
    for (const [section, comp] of Object.entries(variants)) {
      if (!dirNames.has(comp)) {
        missingVariants += 1;
        err("VARIANT_MISSING", `sectionVariants.${section} points to "${comp}" which does not exist under components/.`, "theme.json");
      }
    }
    checks.push({ name: "sectionVariants resolve to component folders", ok: missingVariants === 0 });
    const pages = Array.isArray(theme.pages) ? (theme.pages as { id: string; sections: string[] }[]) : [];
    let unknownSections = 0;
    for (const p of pages) {
      for (const s of p.sections || []) {
        if (!variants[s]) {
          unknownSections += 1;
          warn("PAGE_SECTION", `Page "${p.id}" references section "${s}" with no variant.`, "theme.json");
        }
      }
    }
    checks.push({ name: "page sections reference known variants", ok: unknownSections === 0 });
    const preview = typeof theme.previewImage === "string" ? theme.previewImage : "";
    const previewOk = preview ? await exists(path.join(outputDir, ...preview.split("/"))) : false;
    checks.push({ name: "previewImage exists", ok: previewOk, detail: preview || "none" });
    if (!previewOk) warn("PREVIEW", "previewImage is missing or does not point to a copied asset.", "theme.json");
  }

  // Sanity: outputs should only live in known top-level folders/files
  const allowedTop = new Set([...spec.requiredDirectories, ...spec.optionalDirectories, "theme.json"]);
  const strayTop = entries.filter((e) => !e.rel.includes("/") && !allowedTop.has(e.rel)).map((e) => e.rel);
  checks.push({ name: "no unexpected top-level entries", ok: strayTop.length === 0, detail: strayTop.join(", ") || undefined });
  for (const s of strayTop) warn("STRAY_TOP", `Unexpected top-level entry: ${s}`, s);

  return { ok: issues.every((i) => i.level !== "error"), checks, issues };
}
