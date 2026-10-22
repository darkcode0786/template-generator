import path from "node:path";
import { emptyValueFor, extractDataFields, exportedIdentifiers, findDefaultContent, inferFieldShapes, parseImports, resolveImport, seedValueFor, type AliasConfig } from "./analysis";
import { rewriteColorVars, rewriteThemeHexes, rewriteUtilityColors } from "./cssvars";
import { applyEditorMedia } from "./editorMedia";
import { hoistUseClient, rewriteDynamicIcons, rewriteHeaderNavHrefs, rewritePreviewHrefs, rewriteSvgModules, stabilizeListKeys } from "./themeIcons";
import { cssVarsInjector } from "./cssvars";
import { alignEditorDetailFields } from "./editorDetailFields";
import { inlineTypeImport } from "./inlineTypes";
import { applyFieldAliases } from "./fieldAliases";
import type { ThemeSpec } from "./spec";
import type { ComponentPlan, PlannedFile, UnresolvedImport } from "./types";

export interface TransformContext {
  spec: ThemeSpec;
  component: ComponentPlan;
  source: string;
  aliases: AliasConfig;
  fileSet: Set<string>;
  componentBySource: Map<string, ComponentPlan>;
  /** source asset path (repo-relative, e.g. "public/hero/banner.webp") -> theme path ("assets/hero/banner.webp") */
  assetTargets: Map<string, string>;
  dataFiles: { path: string; json: unknown }[];
  packageDeps: Record<string, string>;
  /** Repo-relative path -> source text, used to copy interfaces onto the component. */
  sources?: Map<string, string>;
  /** Theme Color variables inlined into every component (`--primary-bg` and the host aliases). */
  cssVars?: Record<string, string>;
  /** Brand hexes replaced with host aliases (`--color-primary`, `--color-accent`, `--color-heading`). */
  colorRewrites?: { hex: string; variable: string }[];
  /** Source `var(--color-gold)` names replaced with those aliases. */
  colorVarRewrites?: { from: string; to: string }[];
}

/**
 * Locate the opening brace of the component function body so boilerplate can be
 * inserted as its first statements. Supports `function Name(…) {`,
 * `const Name = (…) => {`, `const Name: FC<P> = (…) => {`, `export default function Name(…) {`.
 * Returns the index just after `{` plus the raw parameter text, or null for expression bodies.
 */
export function findComponentBody(code: string, name: string): { bodyStart: number; params: string } | null {
  const re = new RegExp(`(?:function\\s+${escapeRe(name)}\\s*|(?:const|let|var)\\s+${escapeRe(name)}\\b[^=]*=\\s*(?:React\\.memo\\(|memo\\(|forwardRef\\()?\\s*(?:async\\s*)?)\\(`, "g");
  const m = re.exec(code);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return null;
  const params = code.slice(open + 1, close);
  // Skip an optional return-type annotation / arrow, then require a block body.
  const rest = code.slice(close + 1);
  const bodyMatch = /^\s*(?::\s*[^=>{]+?)?\s*(?:=>)?\s*\{/.exec(rest);
  if (!bodyMatch) return null;
  return { bodyStart: close + 1 + bodyMatch[0].length, params };
}

/**
 * Convert an expression-bodied arrow component (`const X = (p) => <div/>;`) into a block body
 * (`=> {\n  return (<div/>);\n}`) so statements can be inserted. Returns the code unchanged when
 * the component is not an expression-bodied arrow.
 */
export function blockifyArrowBody(code: string, name: string): string {
  const re = new RegExp(`(?:const|let|var)\\s+${escapeRe(name)}\\b[^=]*=\\s*(?:React\\.memo\\(|memo\\(|forwardRef\\()?\\s*(?:async\\s*)?\\(`, "g");
  const m = re.exec(code);
  if (!m) return code;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return code;
  const arrow = /^\s*(?::\s*[^=>{]+?)?\s*=>\s*/.exec(code.slice(close + 1));
  if (!arrow) return code;
  const exprStart = close + 1 + arrow[0].length;
  if (code[exprStart] === "{") return code; // already a block body
  // Expression runs to the first `;` at bracket depth 0 outside string/template literals (or EOF).
  let i = exprStart;
  let d = 0;
  let quote: string | null = null;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(" || ch === "{" || ch === "[") d++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (d === 0) break; // closing paren of memo(...) wrapper
      d--;
    } else if (ch === ";" && d === 0) break;
  }
  const expr = code.slice(exprStart, i).trim();
  if (!expr) return code;
  return `${code.slice(0, exprStart)}{\n  return (${expr});\n}${code.slice(i)}`;
}

/** Insert `text` right after the leading directives (`'use client'`) and before the first import. */
function insertAfterDirectives(code: string, text: string): string {
  const m = /^(\s*(?:(?:'use [^']+'|"use [^"]+")\s*;?\s*)*)/.exec(code);
  const idx = m ? m[0].length : 0;
  return code.slice(0, idx) + text + code.slice(idx);
}

export interface TransformResult {
  code: string;
  componentJson: Record<string, unknown>;
  editorFields: string[];
  defaultContentSource?: string;
  unresolvedImports: UnresolvedImport[];
  dependencies: Record<string, string>;
  warnings: string[];
  fieldRenames: { from: string; to: string; occurrences: number }[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace identifier occurrences with word boundaries, skipping import specifiers. */
function renameIdentifier(code: string, from: string, to: string): string {
  if (from === to) return code;
  return code.replace(new RegExp(`(?<![\\w$.])${escapeRe(from)}(?![\\w$])`, "g"), to);
}

function assetLookupKey(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase();
}

/**
 * Rewrite image strings in defaultContent to `assets/...` (the path the uploader
 * turns into an S3 URL). `hero/banner.webp`, `/hero/banner.webp` and
 * `./assets/hero/banner.webp` all match. Absolute https URLs stay as written.
 * Base64 images are dropped; they must not ship inside JSON.
 */
export function rewriteAssetStrings<T>(value: T, assetTargets: Map<string, string>): { value: T; rewritten: number; strippedBase64: number } {
  let rewritten = 0;
  let strippedBase64 = 0;
  const lookup = new Map<string, string>();
  const add = (key: string, target: string) => {
    const n = assetLookupKey(key);
    if (n) lookup.set(n, target);
  };
  for (const [src, target] of assetTargets) {
    const jsonPath = target.startsWith("assets/") || target.startsWith("styles/") ? target : `assets/${target}`;
    const stripped = src.replace(/^(public|static|src\/assets|assets)\//i, "");
    add(src, jsonPath);
    add(stripped, jsonPath);
    add(`assets/${stripped}`, jsonPath);
    add(jsonPath, jsonPath);
    add(jsonPath.replace(/^assets\//i, ""), jsonPath);
  }
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (/^data:image\//i.test(trimmed)) {
        strippedBase64 += 1;
        return "";
      }
      if (/^https?:\/\//i.test(trimmed)) return v;
      const hit = lookup.get(assetLookupKey(trimmed));
      if (hit && hit !== v) {
        rewritten += 1;
        return hit;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = visit(val);
      return out;
    }
    return v;
  };
  return { value: visit(value) as T, rewritten, strippedBase64 };
}

const MEDIA_EXT = /\.(webp|png|jpe?g|gif|svg|mp4|webm|avif)(\?[^"'`]*)?$/i;

/** `assets/hero/banner.webp` → `/hero/banner.webp`, the argument `mediaSrc` expects. */
export function mediaSrcArg(themePath: string): string {
  const cleaned = themePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  const rest = cleaned.replace(/^assets\//i, "");
  return `/${rest}`;
}

/**
 * Fixed images in a component (`src="/hero/banner.webp"`, `url(/hero/banner.webp)`)
 * 404 on the host, because the file lives in the theme S3 folder, not `public/`.
 * `mediaSrc` resolves that folder. Images already read from `data` are left alone.
 */
export function rewriteHardcodedMedia(code: string, assetTargets: Map<string, string>): { code: string; count: number } {
  const mediaByKey = new Map<string, string>();
  for (const [src, target] of assetTargets) {
    if (!target.startsWith("assets/")) continue;
    if (!MEDIA_EXT.test(target)) continue;
    const media = mediaSrcArg(target);
    for (const key of [src, target, media, src.replace(/^(public|static|src\/assets|assets)\//i, "")]) {
      const n = assetLookupKey(key);
      if (n && MEDIA_EXT.test(n)) mediaByKey.set(n, media);
    }
  }
  if (!mediaByKey.size) return { code, count: 0 };
  const resolve = (raw: string): string | null => mediaByKey.get(assetLookupKey(raw)) ?? null;
  let count = 0;
  const call = (media: string) => {
    count += 1;
    return `mediaSrc(${JSON.stringify(media)})`;
  };

  code = code.replace(/(["'`])([^"'`]*)url\(\s*(['"]?)([^'")]+)\3\s*\)([^"'`]*)\1/g, (full, q: string, before: string, _iq: string, path: string, after: string) => {
    const media = resolve(path);
    if (!media) return full;
    return `${q}${before}url(${q} + ${call(media)} + ${q})${after}${q}`;
  });
  code = code.replace(/(\b(?:src|poster|href)\s*=\s*)(["'])([^"']+)\2/g, (full, pre: string, _q: string, path: string) => {
    const media = resolve(path);
    if (!media) return full;
    return `${pre}{${call(media)}}`;
  });
  code = code.replace(/(["'])([^"'\n]+)\1/g, (full, _q: string, path: string, offset: number, source: string) => {
    const media = resolve(path);
    if (!media) return full;
    const before = source.slice(Math.max(0, offset - 40), offset);
    if (/mediaSrc\(\s*$/.test(before) || /\b(?:from|import)\s*$/.test(before)) return full;
    return call(media);
  });
  return { code, count };
}

export function transformComponent(ctx: TransformContext): TransformResult {
  const { spec, component, aliases, fileSet, componentBySource, packageDeps } = ctx;
  const t = spec.transformations;
  const warnings: string[] = [];
  const unresolvedImports: UnresolvedImport[] = [];
  const dependencies: Record<string, string> = {};
  let code = ctx.source;

  // --- imports -------------------------------------------------------------
  const imports = parseImports(code);
  const replacements: { start: number; end: number; text: string }[] = [];
  const pendingRenames: { from: string; to: string }[] = [];
  const svgModules: { local: string; media: string }[] = [];
  for (const imp of imports) {
    const res = resolveImport(imp.specifier, component.source, aliases, fileSet);
    if (res.kind === "package") {
      const pkgName = imp.specifier.startsWith("@") ? imp.specifier.split("/").slice(0, 2).join("/") : imp.specifier.split("/")[0];
      if (!["react", "react-dom", "next"].includes(pkgName)) {
        dependencies[pkgName] = packageDeps[pkgName] ?? "unknown";
      }
      continue;
    }
    if (res.kind === "local" && res.path && /\.svg$/i.test(res.path.split("?")[0] ?? "")) {
      const target = ctx.assetTargets.get(res.path) ?? ctx.assetTargets.get(res.path.split("?")[0] ?? "");
      const local = imp.defaultName || imp.named.find((n) => /^[A-Za-z_$]/.test(n.local))?.local;
      if (target && local) {
        svgModules.push({ local, media: mediaSrcArg(target) });
        replacements.push({ start: imp.start, end: imp.end, text: "" });
        continue;
      }
    }
    if (res.kind === "local" && res.path) {
      const sibling = componentBySource.get(res.path);
      if (sibling && t.rewriteSiblingImports) {
        const newSpec = `../${sibling.name}/${sibling.name}`;
        let text = imp.raw.replace(/(["'])([^"']+)\1\s*;?\s*$/, `$1${newSpec}$1;`);
        // Sibling now has a default export named after the new component; keep named import working too.
        if (t.renameComponentIdentifier) {
          const oldLocal = imp.defaultName ?? imp.named.find((n) => /^[A-Z]/.test(n.local))?.local;
          if (oldLocal) {
            text = text.replace(/import\s+(type\s+)?[^;]*?\s+from/, `import $1${sibling.name} from`);
            pendingRenames.push({ from: oldLocal, to: sibling.name });
          }
        }
        replacements.push({ start: imp.start, end: imp.end, text });
        continue;
      }
      const inlined = ctx.sources
        ? inlineTypeImport(imp, { fromFile: component.source, sources: ctx.sources, aliases, fileSet })
        : { found: [] as string[], block: "" };
      if (inlined.found.length && inlined.block) {
        const remain = imp.named.filter((n) => !inlined.found.includes(n.imported));
        let text = "";
        if (remain.length || imp.defaultName || imp.namespaceName) {
          const named = remain.map((n) => (n.imported === n.local ? n.imported : `${n.imported} as ${n.local}`)).join(", ");
          const head = [imp.defaultName, imp.namespaceName ? `* as ${imp.namespaceName}` : "", named ? `{ ${named} }` : ""].filter(Boolean).join(", ");
          text = `import ${imp.typeOnly ? "type " : ""}${head} from ${JSON.stringify(imp.specifier)};\n`;
          unresolvedImports.push({
            component: component.name,
            specifier: imp.specifier,
            reason: `resolves to ${res.path}, which is not part of the generated theme`,
          });
        }
        replacements.push({ start: imp.start, end: imp.end, text: `${text}${inlined.block}\n` });
        continue;
      }
      unresolvedImports.push({
        component: component.name,
        specifier: imp.specifier,
        reason: `resolves to ${res.path}, which is not part of the generated theme`,
      });
      continue;
    }
    unresolvedImports.push({ component: component.name, specifier: imp.specifier, reason: "file not found in repository" });
  }
  // Apply import replacements from the end so earlier offsets stay valid, then rename usages.
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, r.start) + r.text + code.slice(r.end);
  }
  for (const r of pendingRenames) code = renameIdentifier(code, r.from, r.to);
  if (svgModules.length) code = rewriteSvgModules(code, svgModules);

  // --- identifier rename / default export ---------------------------------
  const exp = exportedIdentifiers(code);
  const originalName = exp.defaultName && exp.defaultName !== "default" ? exp.defaultName : exp.named.find((n) => /^[A-Z]/.test(n));
  if (t.renameComponentIdentifier && originalName && originalName !== component.name) {
    code = renameIdentifier(code, originalName, component.name);
  }
  const finalName = t.renameComponentIdentifier && originalName ? component.name : originalName;
  const hasDefault = /export\s+default\b/.test(code);
  if (t.ensureDefaultExport && !hasDefault && finalName) {
    code = `${code.replace(/\s*$/, "")}\n\nexport default ${finalName};\n`;
  }
  if (!originalName) warnings.push(`${component.source}: could not determine the exported component identifier; file copied without rename.`);

  // --- editor fields / default content ------------------------------------
  const detectedFields = t.extractEditorFields ? extractDataFields(code) : [];
  const editorFields = [...detectedFields];
  let defaultContent: Record<string, unknown> = {};
  let defaultContentSource: string | undefined;
  if (t.resolveDefaultContent) {
    const match = findDefaultContent(ctx.dataFiles, component.baseName, [component.sectionType], detectedFields);
    if (match) {
      defaultContent = { ...match.value };
      defaultContentSource = match.source;
      if (t.rewriteAssetPaths) {
        const r = rewriteAssetStrings(defaultContent, ctx.assetTargets);
        defaultContent = r.value;
        if (r.strippedBase64) warnings.push(`${component.name}: removed ${r.strippedBase64} base64 image(s) from defaultContent.`);
      }
      if (t.editorFieldsFromDefaultContent) {
        for (const k of Object.keys(defaultContent)) if (!editorFields.includes(k)) editorFields.push(k);
      }
    } else {
      warnings.push(`${component.name}: no matching default content found in data files; keys seeded with empty values.`);
    }
  }
  // Host contract (see reference theme): every editor field must exist in defaultContent.
  if (t.fillMissingEditorFields) {
    const shapes = inferFieldShapes(code, editorFields);
    // An array whose item keys cannot be traced (e.g. merged into another list first) borrows a
    // blank sample from a sibling collection with a related name: navLinksRight <- navLinksLeft.
    const stem = (n: string) => n.replace(/(Left|Right|Top|Bottom|Primary|Secondary|Main|Alt|\d+)$/i, "").toLowerCase();
    const seed = (f: string): unknown => {
      const shape = shapes[f];
      if (shape.kind === "array" && !shape.itemKeys.length) {
        const sibling = Object.entries(defaultContent).find(
          ([k, v]) => k !== f && stem(k) === stem(f) && Array.isArray(v) && v.some((x) => x && typeof x === "object" && !Array.isArray(x)),
        );
        const sample = sibling ? ((sibling[1] as unknown[]).find((x) => x && typeof x === "object") as Record<string, unknown>) : undefined;
        if (sample) return [Object.fromEntries(Object.keys(sample).map((k) => [k, k === "id" ? "item-1" : typeof sample[k] === "number" ? 0 : Array.isArray(sample[k]) ? [] : ""]))];
      }
      return seedValueFor(shape);
    };
    const filled: string[] = [];
    const reshaped: string[] = [];
    for (const f of editorFields) {
      const shape = shapes[f];
      if (!(f in defaultContent)) {
        defaultContent[f] = t.seedFieldShapes ? seed(f) : emptyValueFor(shape.kind);
        filled.push(f);
        continue;
      }
      if (!t.seedFieldShapes) continue;
      // Matched content can still be hollow: the host editor shows nothing for `{}` and cannot
      // "Add item" to `[]`; a `""` where the component iterates breaks `.map`. Re-seed those.
      const v = defaultContent[f];
      const hollow =
        (shape.kind === "object" && v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0 && shape.keys.length > 0) ||
        (shape.kind === "array" && Array.isArray(v) && v.length === 0 && shape.itemKeys.length > 0) ||
        (shape.kind === "array" && v === "") ||
        (shape.kind === "object" && v === "" && shape.keys.length > 0);
      if (hollow) {
        defaultContent[f] = seed(f);
        reshaped.push(f);
      }
    }
    if (filled.length && defaultContentSource) {
      warnings.push(`${component.name}: defaultContent lacked ${filled.join(", ")}; seeded with blank values in the shape the component reads.`);
    }
    if (reshaped.length) {
      warnings.push(`${component.name}: empty ${reshaped.join(", ")} seeded with a blank sample so the editor can show/add items.`);
    }
  }
  // Host editor vocabulary: rename keys consistently in code + content + fields.
  let fieldRenames: TransformResult["fieldRenames"] = [];
  if (t.hostFieldAliases.enabled) {
    const r = applyFieldAliases(code, defaultContent, editorFields, component.sectionType, t.hostFieldAliases);
    code = r.code;
    defaultContent = r.content;
    editorFields.splice(0, editorFields.length, ...r.editorFields);
    fieldRenames = r.renamed;
    if (r.renamed.length) warnings.push(`${component.name}: renamed keys for the host editor: ${r.renamed.map((x) => `${x.from}→${x.to}`).join(", ")}.`);
    for (const s of r.skipped) warnings.push(`${component.name}: kept key "${s.key}" (not renamed to "${s.to}": ${s.reason}).`);
  }
  // Popup detail schema (EditSectionModal): header links are `menu[].url` / `subLinks`,
  // and filtered collections only show their declared child keys (`steps[].desc`, not `description`).
  {
    const detail = alignEditorDetailFields(code, defaultContent, editorFields, component.sectionType);
    code = detail.code;
    defaultContent = detail.content;
    editorFields.splice(0, editorFields.length, ...detail.editorFields);
    if (detail.renamed.length) {
      fieldRenames.push(...detail.renamed);
      warnings.push(`${component.name}: aligned popup detail keys: ${detail.renamed.map((x) => `${x.from}→${x.to}`).join(", ")}.`);
    }
  }
  // Internal keys stay in defaultContent (the component may read them) but are not editable.
  if (t.excludeEditorFields.length) {
    for (let i = editorFields.length - 1; i >= 0; i--) if (t.excludeEditorFields.includes(editorFields[i])) editorFields.splice(i, 1);
  }
  // Host theme root owns color. Fixed hex, `bg-primary`, and unknown variables do not follow Theme Color.
  code = rewriteUtilityColors(code);
  if (ctx.colorRewrites?.length) code = rewriteThemeHexes(code, ctx.colorRewrites);
  if (ctx.colorVarRewrites?.length) code = rewriteColorVars(code, ctx.colorVarRewrites);
  const media = rewriteHardcodedMedia(code, ctx.assetTargets);
  code = rewritePreviewHrefs(rewriteDynamicIcons(applyEditorMedia(media.code, component.sectionType)));
  if (component.sectionType === "Header") code = rewriteHeaderNavHrefs(code);
  // --- host boilerplate (reference convention) ----------------------------
  const wantsCssVars = t.injectCssVars.enabled && ctx.cssVars && Object.keys(ctx.cssVars).length > 0 && !code.includes(t.injectCssVars.styleId);
  const wantsMapper = t.hostAssetMapper.enabled && !code.includes(t.hostAssetMapper.importName);
  if ((wantsCssVars || wantsMapper) && finalName) {
    let body = findComponentBody(code, finalName);
    if (!body) {
      const blockified = blockifyArrowBody(code, finalName);
      if (blockified !== code) {
        code = blockified;
        body = findComponentBody(code, finalName);
      }
    }
    if (!body) {
      warnings.push(`${component.name}: could not locate the component body; host boilerplate not injected.`);
    } else {
      const lines: string[] = [];
      if (wantsCssVars && ctx.cssVars) lines.push(`  ${cssVarsInjector(ctx.cssVars, t.injectCssVars.styleId)}`);
      let addImport = false;
      if (wantsMapper) {
        if (/\bdata\b/.test(body.params)) {
          lines.push(`  data = ${t.hostAssetMapper.importName}(data);`);
          addImport = true;
        } else {
          warnings.push(`${component.name}: component has no \`data\` parameter; asset mapper call not injected.`);
        }
      }
      if (lines.length) {
        code = `${code.slice(0, body.bodyStart)}\n${lines.join("\n")}${code.slice(body.bodyStart)}`;
      }
      if (addImport) {
        code = insertAfterDirectives(code, `import { ${t.hostAssetMapper.importName} } from ${JSON.stringify(t.hostAssetMapper.importPath)};\n`);
      }
    }
  }
  if ((media.count || /\bmediaSrc\s*\(/.test(code)) && !/import\s*\{[^}]*\bmediaSrc\b/.test(code)) {
    const mediaPath = t.hostAssetMapper.importPath.replace(/[^/]+$/, "lexoraPreview");
    code = insertAfterDirectives(code, `import { mediaSrc } from ${JSON.stringify(mediaPath)};\n`);
  }

  const serial = extractDataFields(code);
  const rank = new Map(serial.map((name, index) => [name, index]));
  const leftover = editorFields.filter((field) => !rank.has(field));
  editorFields.splice(0, editorFields.length, ...serial.filter((field) => editorFields.includes(field)), ...leftover);
  const orderedContent: Record<string, unknown> = {};
  for (const field of editorFields) if (field in defaultContent) orderedContent[field] = defaultContent[field];
  for (const [key, value] of Object.entries(defaultContent)) if (!(key in orderedContent)) orderedContent[key] = value;
  defaultContent = orderedContent;

  if (t.appendEditorFieldsStatic && finalName && editorFields.length && !/\.editorFields\s*=/.test(code)) {
    code = `${code.replace(/\s*$/, "")}\n\n(${finalName} as typeof ${finalName} & { editorFields: readonly string[] }).editorFields = ${JSON.stringify(editorFields)};\n`;
  }
  code = hoistUseClient(stabilizeListKeys(code));

  const componentJson = {
    key: component.name,
    sectionType: component.sectionType,
    sectionNumber: component.sectionNumber,
    scope: component.scope,
    name: component.name,
    folder: component.folder,
    editorFields,
    defaultContent,
  };

  return { code, componentJson, editorFields, defaultContentSource, unresolvedImports, dependencies, warnings, fieldRenames };
}

/** Build the asset lookup used for default-content path rewriting. */
export function assetTargetMap(files: PlannedFile[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) {
    if (f.kind === "image" || f.kind === "icon" || f.kind === "other") {
      m.set(f.source, f.target.startsWith("assets/") ? f.target : `assets/${f.target}`);
    }
    // fonts live under styles/, outside the host's assets/ mapping: keep the full theme-relative path
    if (f.kind === "font") m.set(f.source, f.target);
  }
  return m;
}

export function relativeImportPath(fromFile: string, toFile: string): string {
  let rel = path.posix.relative(path.posix.dirname(fromFile), toFile).replace(/\.(tsx|jsx|ts|js)$/, "");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}
