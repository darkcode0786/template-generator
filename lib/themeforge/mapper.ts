import fs from "node:fs/promises";
import path from "node:path";
import { aliasesFromTsconfig, exportedIdentifiers, extractDataFields, extractDeclaredPageOrder, orderByDeclaredRoutes, parseImports, primaryJsxUsageOrder, resolveImport, type AliasConfig, type DeclaredRoute } from "./analysis";
import { matchesAny } from "./glob";
import { isSafeRelativePath, pascalCase, sanitizeAssetTarget, titleCase } from "./paths";
import type { MappingRule, ThemeSpec } from "./spec";
import type { ComponentPlan, ExcludedFile, MappingPlan, PagePlan, PlannedFile, ScanResult } from "./types";

export interface MapperContext {
  repoDir: string;
  templatePascal: string;
  spec: ThemeSpec;
  scan: ScanResult;
}

function applyStripPrefix(rel: string, prefixes: string[]): string {
  for (const p of prefixes) {
    if (rel.toLowerCase().startsWith(p.toLowerCase())) return rel.slice(p.length);
  }
  return rel;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  const out = template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
  // collapse "//" produced by empty {relativeDir}
  return out.replace(/\/{2,}/g, "/").replace(/^\//, "");
}

function componentBaseName(rel: string, spec: ThemeSpec): string {
  let stem = path.posix.basename(rel).replace(/\.[^.]+$/, "");
  if (/^index$/i.test(stem)) stem = path.posix.basename(path.posix.dirname(rel));
  let base = pascalCase(stem);
  for (const suffix of spec.naming.stripSuffixes) {
    if (base.length > suffix.length && base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  return base || "Component";
}

function sectionTypeFor(base: string, spec: ThemeSpec): string {
  return spec.naming.sectionTypeAliases[base] ?? base;
}

function folderFor(sectionType: string, base: string, spec: ThemeSpec): string {
  const map = spec.naming.folderBySectionType;
  if (map[sectionType]) return map[sectionType];
  if (map[base]) return map[base];
  // Try a suffix match (e.g. "ServicesBreadcrumb" -> "breadcrumb")
  for (const [k, v] of Object.entries(map)) {
    if (sectionType.endsWith(k) && k.length >= 4) return v;
  }
  return spec.naming.defaultFolder;
}

function firstMatchingRule(rel: string, rules: MappingRule[]): MappingRule | null {
  for (const rule of rules) {
    if (matchesAny(rel, rule.match) && !matchesAny(rel, rule.ignore)) return rule;
  }
  return null;
}

async function readJsonSafe(file: string): Promise<Record<string, unknown> | null> {
  try {
    // tsconfig may contain comments/trailing commas; strip the common cases.
    const raw = (await fs.readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Build the deterministic source -> target plan. Nothing is written here. */
export async function buildMappingPlan(ctx: MapperContext): Promise<MappingPlan> {
  const { spec, scan, templatePascal } = ctx;
  const warnings: string[] = [];
  const skipped: ExcludedFile[] = [];
  const files: PlannedFile[] = [];
  const components: ComponentPlan[] = [];
  const prefix = spec.naming.componentPrefix.replace("{TemplatePascal}", templatePascal);

  // 1. Components
  const sectionCounters = new Map<string, number>();
  const componentRule = spec.mappings.find((r) => r.kind === "component");
  const componentFiles = componentRule
    ? scan.files.filter((f) => matchesAny(f.path, componentRule.match) && !matchesAny(f.path, componentRule.ignore))
    : [];
  const componentBySource = new Map<string, ComponentPlan>();

  for (const f of componentFiles) {
    const source = await fs.readFile(path.join(ctx.repoDir, f.path), "utf8").catch(() => "");
    const exp = exportedIdentifiers(source);
    const hasComponentExport = Boolean(exp.defaultName) || exp.named.some((n) => /^[A-Z]/.test(n));
    if (!hasComponentExport) {
      skipped.push({ path: f.path, reason: "no exported React component found" });
      continue;
    }
    if (spec.transformations.skipComponentsWithoutEditorFields && extractDataFields(source).length === 0) {
      skipped.push({ path: f.path, reason: "reads no `data` prop (utility component, not an editable section)" });
      warnings.push(`Skipped ${f.path}: it reads no \`data\` prop, so it cannot be an editable theme section.`);
      continue;
    }
    const base = componentBaseName(f.path, spec);
    const sectionType = sectionTypeFor(base, spec);
    const n = (sectionCounters.get(sectionType) ?? 0) + 1;
    sectionCounters.set(sectionType, n);
    const name = `${prefix}${sectionType}${n}`;
    const ext = f.ext === ".jsx" ? ".jsx" : ".tsx";
    const targetDir = `components/${name}`;
    const plan: ComponentPlan = {
      source: f.path,
      baseName: base,
      sectionType,
      sectionNumber: n,
      name,
      folder: folderFor(sectionType, base, spec),
      scope: spec.naming.defaultScope,
      targetDir,
      targetFile: `${targetDir}/${name}${ext}`,
    };
    if (n > 1) warnings.push(`Multiple components map to section type "${sectionType}": ${f.path} became ${name}.`);
    components.push(plan);
    componentBySource.set(f.path, plan);
    files.push({ source: f.path, target: plan.targetFile, kind: "component", rule: componentRule!.id, size: f.size, action: "transform" });
  }

  // 2. Everything else through the ordered mapping rules
  const targets = new Map<string, PlannedFile>();
  for (const pf of files) targets.set(pf.target.toLowerCase(), pf);

  for (const f of scan.files) {
    if (componentBySource.has(f.path)) continue;
    if (componentRule && matchesAny(f.path, componentRule.match)) {
      // component rule matched but file was skipped above or ignored
      if (!skipped.some((s) => s.path === f.path)) skipped.push({ path: f.path, reason: "ignored by component rule" });
      continue;
    }
    const rule = firstMatchingRule(f.path, spec.mappings.filter((r) => r.kind !== "component"));
    if (!rule) {
      skipped.push({ path: f.path, reason: `no mapping rule (${f.category})` });
      continue;
    }
    if (path.posix.basename(f.path).startsWith(".")) {
      skipped.push({ path: f.path, reason: "dotfile (skipped; S3 upload ignores names starting with '.')" });
      continue;
    }
    const stripped = applyStripPrefix(f.path, rule.stripPrefix);
    const relativeDir = path.posix.dirname(stripped) === "." ? "" : path.posix.dirname(stripped);
    const basename = path.posix.basename(stripped);
    const ext = path.posix.extname(basename);
    const stem = basename.slice(0, basename.length - ext.length);
    const rawTarget = fillTemplate(rule.target, { relativeDir, basename, stem, ext });
    const target = rule.kind === "image" || rule.kind === "icon" || rawTarget.startsWith("assets/") ? sanitizeAssetTarget(rawTarget) : rawTarget;
    if (!isSafeRelativePath(target)) {
      skipped.push({ path: f.path, reason: `unsafe target path "${target}"` });
      continue;
    }

    // Conflict handling
    if (targets.has(target.toLowerCase())) {
      const existing = targets.get(target.toLowerCase())!;
      if (spec.conflicts.policy === "error") {
        throw new Error(`Target conflict: ${f.path} and ${existing.source} both map to ${target}`);
      }
      if (spec.conflicts.policy === "skip") {
        skipped.push({ path: f.path, reason: `target ${target} already produced by ${existing.source} (policy: skip)` });
        continue;
      }
      let n = 2;
      let candidate = target;
      const dir = path.posix.dirname(target);
      while (targets.has(candidate.toLowerCase())) {
        const renamed = spec.conflicts.renamePattern.replace("{stem}", stem).replace("{n}", String(n)).replace("{ext}", ext);
        candidate = dir === "." ? renamed : `${dir}/${renamed}`;
        n += 1;
      }
      warnings.push(`Renamed ${f.path} -> ${candidate} to avoid overwriting ${existing.source} (policy: rename).`);
      const pf: PlannedFile = { source: f.path, target: candidate, kind: rule.kind, rule: rule.id, size: f.size, action: "copy", renamedFrom: target };
      targets.set(candidate.toLowerCase(), pf);
      files.push(pf);
      continue;
    }
    const pf: PlannedFile = { source: f.path, target, kind: rule.kind, rule: rule.id, size: f.size, action: "copy" };
    targets.set(target.toLowerCase(), pf);
    files.push(pf);
  }

  // 3. Pages -> section lists, in the order the repository itself declares
  const analyzed = await analyzePages(ctx, componentBySource);
  const pages = analyzed.pages;
  if (analyzed.orderSource) warnings.push(`Page order follows ${analyzed.orderSource}.`);
  for (const p of pages) {
    for (const u of p.unresolvedComponents) warnings.push(`Page ${p.source}: component <${u}> could not be matched to a theme component.`);
  }

  if (!components.length) warnings.push("No React components were found in the configured component directories.");

  return { files, components, pages, skipped, warnings };
}

function routeFromPage(rel: string): { route: string; id: string } | null {
  const posix = rel.replace(/\\/g, "/");
  let m = posix.match(/^(?:src\/)?app\/(?:(.*)\/)?page\.(tsx|jsx|js|ts)$/);
  let route: string;
  if (m) {
    route = m[1] ?? "";
  } else {
    m = posix.match(/^(?:src\/)?pages\/(.*?)\.(tsx|jsx|js|ts)$/);
    if (!m) return null;
    route = m[1].replace(/(^|\/)index$/, "");
    if (/^(_app|_document|_error|api(\/|$))/.test(route)) return null;
  }
  // Drop route groups "(marketing)" and parallel/intercepting segments
  route = route
    .split("/")
    .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"))
    .join("/");
  const id = route === "" ? "home" : route.replace(/\[\.\.\.(\w+)\]/g, "$1").replace(/\[(\w+)\]/g, "$1-detail").replace(/[^A-Za-z0-9/-]/g, "").replace(/\//g, "-").toLowerCase();
  return { route: route === "" ? "/" : `/${route}`, id };
}

async function analyzePages(ctx: MapperContext, componentBySource: Map<string, ComponentPlan>): Promise<{ pages: PagePlan[]; orderSource?: string }> {
  const { scan, repoDir } = ctx;
  const fileSet = new Set(scan.files.map((f) => f.path));
  const hasSrc = scan.files.some((f) => f.path.startsWith("src/"));
  const tsconfig = (await readJsonSafe(path.join(repoDir, "tsconfig.json"))) ?? (await readJsonSafe(path.join(repoDir, "jsconfig.json")));
  const aliases: AliasConfig = aliasesFromTsconfig(tsconfig, hasSrc);

  const pageFiles = scan.files.filter((f) => f.category === "page");
  const pages: PagePlan[] = [];
  for (const pf of pageFiles) {
    const r = routeFromPage(pf.path);
    if (!r) continue;
    const source = await fs.readFile(path.join(repoDir, pf.path), "utf8").catch(() => "");
    const imports = parseImports(source);
    const localToComponent = new Map<string, ComponentPlan>();
    const localNames: string[] = [];
    for (const imp of imports) {
      const res = resolveImport(imp.specifier, pf.path, aliases, fileSet);
      if (res.kind !== "local" || !res.path) continue;
      const comp = componentBySource.get(res.path);
      if (!comp) continue;
      const locals = [imp.defaultName, ...imp.named.map((n) => n.local)].filter((x): x is string => Boolean(x));
      for (const l of locals) {
        localToComponent.set(l, comp);
        localNames.push(l);
      }
    }
    // Also look for any JSX tags that look like components but were not resolved.
    const allTags = new Set<string>();
    for (const m of source.matchAll(/<([A-Z][\w$.]*)(?=[\s/>])/g)) allTags.add(m[1]);
    const unresolved = [...allTags].filter((t) => !localToComponent.has(t) && !["Fragment", "React.Fragment", "Link", "Image", "Suspense", "Script", "Head"].includes(t));

    const order = primaryJsxUsageOrder(source, localNames);
    const sections: string[] = [];
    for (const local of order) {
      const comp = localToComponent.get(local)!;
      if (!sections.includes(comp.sectionType)) sections.push(comp.sectionType);
    }
    pages.push({
      id: r.id,
      label: r.id === "home" ? "Home" : titleCase(r.id.replace(/-detail$/, " Detail")),
      sectionType: r.id === "home" ? "Home" : pascalCase(r.id),
      route: r.route,
      source: pf.path,
      sections,
      unresolvedComponents: unresolved,
    });
  }
  const declared = await findDeclaredPageOrder(ctx, pages);
  return { pages: orderByDeclaredRoutes(pages, declared?.order ?? null), orderSource: declared?.source };
}

const ORDER_SOURCE_CATEGORIES = new Set(["component", "page", "layout", "script"]);

/** The source file that names the most real page routes, in the order it names them. */
async function findDeclaredPageOrder(ctx: MapperContext, pages: PagePlan[]): Promise<{ order: DeclaredRoute[]; source: string } | null> {
  const routes = pages.map((p) => p.route);
  let best: { score: number; order: DeclaredRoute[]; source: string } | null = null;
  for (const f of ctx.scan.files) {
    if (!ORDER_SOURCE_CATEGORIES.has(f.category) || f.size > 250_000) continue;
    if (/\.(test|spec)\.[tj]sx?$/.test(f.path)) continue;
    const source = await fs.readFile(path.join(ctx.repoDir, f.path), "utf8").catch(() => "");
    if (!source) continue;
    const order = extractDeclaredPageOrder(source, routes);
    const listed = order.filter((d) => d.route !== "/").length;
    if (listed < 3) continue;
    const score = listed * 10 + (/sitemap/i.test(f.path) ? 5 : 0);
    if (!best || score > best.score) best = { score, order, source: f.path };
  }
  return best ? { order: best.order, source: best.source } : null;
}
