import path from "node:path";

export interface ParsedImport {
  specifier: string;
  defaultName?: string;
  namespaceName?: string;
  named: { imported: string; local: string }[];
  typeOnly: boolean;
  start: number;
  end: number;
  raw: string;
}

const IMPORT_RE = /^[ \t]*import\s+(type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?\s*from\s*["']([^"']+)["'];?/gm;
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s+["']([^"']+)["'];?/gm;

/** Lightweight, regex-based ES import parser (sufficient for component files). */
export function parseImports(source: string): ParsedImport[] {
  const out: ParsedImport[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const [raw, typeKw, defaultName, namespaceName, namedBlock, specifier] = m;
    const named: { imported: string; local: string }[] = [];
    if (namedBlock) {
      for (const part of namedBlock.split(",")) {
        const p = part.replace(/^\s*type\s+/, "").trim();
        if (!p) continue;
        const [imported, local] = p.split(/\s+as\s+/).map((s) => s.trim());
        named.push({ imported, local: local || imported });
      }
    }
    out.push({
      specifier,
      defaultName: defaultName || undefined,
      namespaceName: namespaceName || undefined,
      named,
      typeOnly: Boolean(typeKw),
      start: m.index ?? 0,
      end: (m.index ?? 0) + raw.length,
      raw,
    });
  }
  for (const m of source.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    out.push({ specifier: m[1], named: [], typeOnly: false, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, raw: m[0] });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Order of first appearance of `<Identifier` JSX tags among the given identifiers. */
export function jsxUsageOrder(source: string, identifiers: Iterable<string>): string[] {
  const wanted = new Set(identifiers);
  const seen: { name: string; index: number }[] = [];
  for (const name of wanted) {
    const re = new RegExp(`<${name.replace(/\$/g, "\\$")}(?=[\\s/>])`, "g");
    const m = re.exec(source);
    if (m) seen.push({ name, index: m.index });
  }
  return seen.sort((a, b) => a.index - b.index).map((s) => s.name);
}

function skipString(source: string, i: number): number {
  const q = source[i];
  if (q !== '"' && q !== "'" && q !== "`") return i;
  i += 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (q === "`" && source[i] === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        const c = source[i];
        if (c === '"' || c === "'" || c === "`") {
          i = skipString(source, i);
          continue;
        }
        if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    if (source[i] === q) return i + 1;
    i += 1;
  }
  return i;
}

/** `return (` / `return <` sites, with the brace depth they occur at. */
function statementReturnSites(source: string): { index: number; depth: number }[] {
  const sites: { index: number; depth: number }[] = [];
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const n = source.indexOf("\n", i);
      i = n < 0 ? source.length : n + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const n = source.indexOf("*/", i + 2);
      i = n < 0 ? source.length : n + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i);
      continue;
    }
    if (c === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "}") {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (source.startsWith("return", i) && (i === 0 || !/[A-Za-z0-9_$]/.test(source[i - 1])) && !/[A-Za-z0-9_$]/.test(source[i + 6] ?? "")) {
      let j = i + 6;
      while (j < source.length && /\s/.test(source[j])) j += 1;
      if (source[j] === "(" || source[j] === "<") sites.push({ index: i, depth });
      i += 6;
      continue;
    }
    i += 1;
  }
  return sites;
}

/**
 * JSX order of the page's real render.
 * Early `if (!x) return (...)` branches are shallower-or-later losers: the
 * shallowest return with the most theme components wins, and a later return
 * wins a tie. That keeps a not-found branch from placing Footer before the
 * breadcrumb that the successful return actually renders.
 */
export function primaryJsxUsageOrder(source: string, identifiers: Iterable<string>): string[] {
  const sites = statementReturnSites(source);
  if (!sites.length) return jsxUsageOrder(source, identifiers);
  const minDepth = Math.min(...sites.map((s) => s.depth));
  const tops = sites.filter((s) => s.depth === minDepth);
  let best: string[] = [];
  for (let i = 0; i < tops.length; i++) {
    const slice = source.slice(tops[i].index, tops[i + 1]?.index ?? source.length);
    const order = jsxUsageOrder(slice, identifiers);
    if (order.length >= best.length) best = order;
  }
  return best.length ? best : jsxUsageOrder(source, identifiers);
}

export interface DeclaredRoute {
  route: string;
  label?: string;
}

function readLabel(chunk: string): string | undefined {
  const matches = [...chunk.matchAll(/(?:name|label|title)\s*:\s*(?:[\s\S]{0,200}?\|\|\s*)?['"]([^'"]{1,80})['"]/g)];
  const last = matches.at(-1)?.[1]?.trim();
  if (!last || last.startsWith("/") || last.includes("${") || last.includes("\\")) return undefined;
  return last;
}

/** Label that belongs to this url, not the previous or next page entry. */
function labelForUrl(source: string, index: number, urlLength: number): string | undefined {
  const before = source.slice(Math.max(0, index - 500), index);
  const keyAt = (from: number) => Math.max(before.lastIndexOf("url:", from), before.lastIndexOf("href:", from));
  const currentKey = keyAt(before.length);
  const priorKey = currentKey > 0 ? keyAt(currentKey - 1) : -1;
  const ownBefore = priorKey >= 0 ? before.slice(priorKey + 4) : currentKey >= 0 ? before.slice(0, currentKey) : before;
  const beforeLabel = readLabel(ownBefore);
  if (beforeLabel) return beforeLabel;
  const after = source.slice(index + urlLength, index + urlLength + 240);
  const end = after.indexOf("}");
  return readLabel(end >= 0 ? after.slice(0, end) : after);
}

function dynamicChild(parent: string, knownRoutes: string[]): string | null {
  const children = knownRoutes.filter((r) => r.startsWith(`${parent}/[`) && !r.slice(parent.length + 1).includes("/"));
  if (!children.length) return null;
  return [...children].sort()[0];
}

/**
 * Routes a source file declares, in source order.
 * String urls (`url: '/about'`) and template urls (`` `/services/${slug}` ``)
 * are kept when they match a real page route. The first label/name/title
 * string beside each url is kept as the page label.
 */
export function extractDeclaredPageOrder(source: string, knownRoutes: string[]): DeclaredRoute[] {
  const known = new Set(knownRoutes);
  const found: { route: string; label?: string; index: number }[] = [];
  for (const m of source.matchAll(/(['"])(\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?)\1/g)) {
    const route = m[2];
    if (!known.has(route)) continue;
    found.push({ route, index: m.index ?? 0, label: labelForUrl(source, m.index ?? 0, m[0].length) });
  }
  for (const m of source.matchAll(/`(\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\/\$\{/g)) {
    const route = dynamicChild(m[1], knownRoutes);
    if (!route) continue;
    found.push({ route, index: m.index ?? 0, label: labelForUrl(source, m.index ?? 0, m[0].length) });
  }
  found.sort((a, b) => a.index - b.index);
  const out: DeclaredRoute[] = [];
  const seen = new Set<string>();
  for (const hit of found) {
    if (seen.has(hit.route)) continue;
    seen.add(hit.route);
    out.push({ route: hit.route, label: hit.label });
  }
  return out;
}

/**
 * Home stays first. Declared routes follow the repository's own list.
 * A dynamic page the list does not name sits directly after its parent.
 * Anything still unnamed keeps route order at the end.
 */
export function orderByDeclaredRoutes<T extends { id: string; route: string; label: string }>(pages: T[], declared: DeclaredRoute[] | null): T[] {
  const labeled = new Map<string, string>();
  for (const d of declared ?? []) if (d.label) labeled.set(d.route, d.label);
  const applyLabel = (p: T): T => {
    const label = labeled.get(p.route);
    if (label) p.label = label;
    return p;
  };
  const home = pages.filter((p) => p.id === "home").map(applyLabel);
  const rest = pages.filter((p) => p.id !== "home");
  const listed = (declared ?? []).filter((d) => d.route !== "/");
  if (listed.length < 3) {
    return [...home, ...[...rest].sort((a, b) => a.route.localeCompare(b.route)).map(applyLabel)];
  }
  const declaredSet = new Set((declared ?? []).map((d) => d.route));
  const byRoute = new Map(rest.map((p) => [p.route, p]));
  const used = new Set<string>();
  const ordered: T[] = [...home];
  const take = (p: T | undefined) => {
    if (!p || used.has(p.id)) return;
    used.add(p.id);
    ordered.push(applyLabel(p));
  };
  for (const d of declared ?? []) {
    if (d.route === "/") continue;
    take(byRoute.get(d.route));
    const children = rest
      .filter((p) => !used.has(p.id) && !declaredSet.has(p.route) && p.route.startsWith(`${d.route}/`))
      .sort((a, b) => a.route.localeCompare(b.route));
    for (const child of children) take(child);
  }
  for (const p of [...rest].filter((p) => !used.has(p.id)).sort((a, b) => a.route.localeCompare(b.route))) take(p);
  return ordered;
}

/** Fields read from the `data` prop: data.x, data?.x, data["x"], const { a, b } = data */
export function extractDataFields(source: string): string[] {
  const fields: string[] = [];
  const push = (f: string) => {
    if (!fields.includes(f)) fields.push(f);
  };
  for (const m of source.matchAll(/\bdata\??\.([A-Za-z_$][\w$]*)/g)) {
    if (!["map", "length", "filter", "forEach", "slice", "join", "find", "some", "every", "reduce", "keys", "entries"].includes(m[1])) push(m[1]);
  }
  for (const m of source.matchAll(/\bdata\??\.?\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]/g)) push(m[1]);
  for (const m of source.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:props\.)?data\b/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(/[:=]/)[0].trim().replace(/^\.\.\./, "");
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) push(name);
    }
  }
  return fields;
}

/** Local identifiers that are exported from a module (for component discovery). */
export function exportedIdentifiers(source: string): { defaultName?: string; named: string[] } {
  const named: string[] = [];
  let defaultName: string | undefined;
  for (const m of source.matchAll(/export\s+(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) named.push(m[1]);
  for (const m of source.matchAll(/export\s+default\s+(?:async\s+)?(?:function\*?|class)\s*([A-Za-z_$][\w$]*)?/g)) defaultName = m[1] || defaultName || "default";
  const dm = source.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/);
  if (dm && !defaultName) defaultName = dm[1];
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const [local, alias] = part.trim().split(/\s+as\s+/);
      if (!local) continue;
      if (alias === "default") defaultName = local;
      else named.push(alias || local);
    }
  }
  return { defaultName, named: [...new Set(named)] };
}

export interface AliasConfig {
  /** e.g. { "@/": "", "~/": "src/" } — prefix -> repo-relative dir prefix */
  prefixes: Record<string, string>;
}

/** Derive path alias prefixes from tsconfig/jsconfig "paths". Defaults to @/ -> root (or src/). */
export function aliasesFromTsconfig(tsconfig: Record<string, unknown> | null, hasSrc: boolean): AliasConfig {
  const prefixes: Record<string, string> = {};
  const co = (tsconfig?.compilerOptions || {}) as Record<string, unknown>;
  const baseUrl = typeof co.baseUrl === "string" ? co.baseUrl.replace(/^\.\/?/, "").replace(/\/$/, "") : "";
  const paths = (co.paths || {}) as Record<string, string[]>;
  for (const [key, targets] of Object.entries(paths)) {
    if (!key.endsWith("/*") || !targets?.length) continue;
    const prefix = key.slice(0, -1); // "@/*" -> "@/"
    const t = targets[0].replace(/\/\*$/, "").replace(/^\.\/?/, "");
    const full = [baseUrl, t].filter(Boolean).join("/");
    prefixes[prefix] = full ? `${full}/` : "";
  }
  if (!Object.keys(prefixes).length) prefixes["@/"] = hasSrc ? "src/" : "";
  return { prefixes };
}

const RESOLVE_EXT = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json", ".css", ".scss"];

/**
 * Resolve an import specifier to a repository-relative file path.
 * Returns null for bare package imports or when the file does not exist.
 */
export function resolveImport(specifier: string, fromFile: string, aliases: AliasConfig, fileSet: Set<string>): { kind: "package" | "local" | "missing"; path?: string } {
  let base: string | null = null;
  if (specifier.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  } else {
    for (const [prefix, dir] of Object.entries(aliases.prefixes)) {
      if (specifier.startsWith(prefix)) {
        base = path.posix.normalize(dir + specifier.slice(prefix.length));
        break;
      }
    }
  }
  if (base === null) return { kind: "package" };
  if (base.startsWith("..")) return { kind: "missing" };
  const candidates = [base, ...RESOLVE_EXT.map((e) => base + e), ...RESOLVE_EXT.map((e) => `${base}/index${e}`)];
  const lowerSet = new Map([...fileSet].map((f) => [f.toLowerCase(), f]));
  for (const c of candidates) {
    const hit = lowerSet.get(c.toLowerCase());
    if (hit) return { kind: "local", path: hit };
  }
  return { kind: "missing", path: base };
}

export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface DefaultContentMatch {
  value: Record<string, unknown>;
  source: string; // file#json.path
  score: number;
}

/**
 * Find the JSON object in the repo's data files that most plausibly holds the
 * default content for a component.
 *
 * Primary signal: how many of the component's `editorFields` exist as keys on
 * the candidate object (this is what the host validates). Secondary signal:
 * key-name similarity to the component base name / section type. Depth is a
 * tie-breaker so top-level variant objects beat nested fragments.
 */
export function findDefaultContent(
  dataFiles: { path: string; json: unknown }[],
  baseName: string,
  aliases: string[] = [],
  editorFields: string[] = [],
): DefaultContentMatch | null {
  const targets = [baseName, ...aliases].map(normalizeKey).filter(Boolean);
  const fieldSet = new Set(editorFields);
  let best: DefaultContentMatch | null = null;

  const nameScore = (key: string): number => {
    const nk = normalizeKey(key);
    let score = 0;
    for (const t of targets) {
      if (nk === t || nk === `${t}1`) score = Math.max(score, 3);
      else if (new RegExp(`${t}\\d+$`).test(nk)) score = Math.max(score, 2);
      else if (nk.endsWith(t) && nk.length <= t.length + 12) score = Math.max(score, 1);
    }
    return score;
  };

  const visit = (node: unknown, file: string, trail: string[], depth: number) => {
    if (!node || typeof node !== "object" || Array.isArray(node) || depth > 8) return;
    for (const [key, rawValue] of Object.entries(node as Record<string, unknown>)) {
      if (!rawValue || typeof rawValue !== "object") continue;
      // A list of records (e.g. `service_details: [{slug, title, …}, …]`) feeds a detail component
      // one entry at a time: the first entry is the natural default content.
      const fromList = Array.isArray(rawValue);
      const value = fromList ? (rawValue as unknown[]).find((e) => e && typeof e === "object" && !Array.isArray(e)) : rawValue;
      if (!value) continue;
      const v = value as Record<string, unknown>;
      const keys = Object.keys(v);
      const isContainer = "variants" in v && keys.length <= 2;
      if (keys.length > 0 && !isContainer) {
        const overlap = fieldSet.size ? keys.filter((k) => fieldSet.has(k)).length : 0;
        const ns = nameScore(key);
        // Require either real field overlap or a name match; overlap dominates.
        // A list entry is a slightly weaker candidate than a dedicated object with the same overlap.
        if (overlap > 0 || ns > 0) {
          const coverage = fieldSet.size ? overlap / fieldSet.size : 0;
          const score = Math.round(coverage * 1000) + overlap * 10 + ns * 5 - depth - (fromList ? 1 : 0);
          const source = `${file}#${[...trail, key].join(".")}${fromList ? "[0]" : ""}`;
          if (!best || score > best.score) best = { value: v, source, score };
        }
      }
      if (!fromList) visit(value, file, [...trail, key], depth + 1);
    }
  };
  for (const f of dataFiles) visit(f.json, f.path, [], 0);
  // A pure name match with zero field overlap is unreliable when we know the fields.
  if (best && fieldSet.size && !Object.keys((best as DefaultContentMatch).value).some((k) => fieldSet.has(k))) return null;
  return best;
}

export type FieldKind = "array" | "object" | "string";

/**
 * Infer the shape of each `data.<field>` from how the component uses it, so
 * missing keys can be filled with a sensible empty default.
 */
export function inferFieldKinds(source: string, fields: string[]): Record<string, FieldKind> {
  const out: Record<string, FieldKind> = {};
  for (const f of fields) {
    const esc = f.replace(/\$/g, "\\$");
    if (
      new RegExp(
        `\\bdata\\??\\.${esc}\\??\\.(map|length|filter|forEach|slice|some|every|find|reduce)\\b|\\bdata\\??\\.${esc}\\??\\.\\[|Array\\.isArray\\(\\s*data\\??\\.${esc}\\b|\\bdata\\??\\.${esc}\\s*(?:\\|\\||\\?\\?)\\s*\\[\\]`,
      ).test(source)
    ) {
      out[f] = "array";
    } else if (
      new RegExp(`\\bdata\\??\\.${esc}\\??\\.[A-Za-z_$]|(?:const|let|var)\\s*\\{[^}]*\\}\\s*=\\s*data\\??\\.${esc}\\b|\\bdata\\??\\.${esc}\\s*(?:\\|\\||\\?\\?)\\s*\\{\\}`).test(source)
    ) {
      out[f] = "object";
    } else {
      out[f] = "string";
    }
  }
  return out;
}

export function emptyValueFor(kind: FieldKind): unknown {
  return kind === "array" ? [] : kind === "object" ? {} : "";
}

export interface FieldShape {
  kind: FieldKind;
  /** object fields: sub-keys read in the component (`data.badge.label` -> ["label"]) */
  keys: string[];
  /** array fields: keys read on each item (`data.cards.map(c => c.title)` -> ["title"]) */
  itemKeys: string[];
}

const ARRAY_METHODS = "map|length|filter|forEach|slice|some|every|find|reduce|flatMap|sort|at|includes|join";

function identifierList(destructured: string): string[] {
  return destructured
    .split(",")
    .map((p) => p.split(/[:=]/)[0].trim().replace(/^\.\.\./, ""))
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
}

/**
 * Like {@link inferFieldKinds} but also records which sub-keys / item keys the component reads,
 * so a missing field can be seeded with the shape the editor needs: the host's section editor
 * renders nothing for `{}` and cannot "Add item" to `[]` without a sample object.
 */
export function inferFieldShapes(source: string, fields: string[]): Record<string, FieldShape> {
  const kinds = inferFieldKinds(source, fields);
  const out: Record<string, FieldShape> = {};
  for (const f of fields) {
    const esc = f.replace(/\$/g, "\\$");
    const keys = new Set<string>();
    const itemKeys = new Set<string>();
    if (kinds[f] === "object") {
      for (const m of source.matchAll(new RegExp(`\\bdata\\??\\.${esc}\\??\\.([A-Za-z_$][\\w$]*)`, "g"))) {
        if (!new RegExp(`^(${ARRAY_METHODS}|toString|valueOf)$`).test(m[1])) keys.add(m[1]);
      }
      for (const m of source.matchAll(new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*data\\??\\.${esc}\\b`, "g"))) {
        for (const k of identifierList(m[1])) keys.add(k);
      }
    }
    if (kinds[f] === "array") {
      // data?.cards?.map((card, i) => … card.title … ) / .map(({ title, desc }) => …)
      // also (data.cards || []).slice(0, 4).map(…)
      const chain = `(?:\\bdata\\??\\.${esc}|\\(\\s*data\\??\\.${esc}\\s*(?:\\|\\||\\?\\?)\\s*\\[\\]\\s*\\))\\??(?:\\.(?:slice|filter|sort)\\([^)]*\\))*\\??\\.(?:map|forEach|flatMap)\\(\\s*\\(?\\s*`;
      for (const m of source.matchAll(new RegExp(`${chain}\\{([^}]*)\\}`, "g"))) {
        for (const k of identifierList(m[1])) itemKeys.add(k);
      }
      for (const m of source.matchAll(new RegExp(`${chain}([A-Za-z_$][\\w$]*)`, "g"))) {
        const v = m[1];
        if (v === "_" ) continue;
        // callback body: scan forward a bounded window for `v.key` / `v?.key`
        const window = source.slice(m.index ?? 0, (m.index ?? 0) + 6000);
        for (const k of window.matchAll(new RegExp(`\\b${v.replace(/\$/g, "\\$")}\\??\\.([A-Za-z_$][\\w$]*)`, "g"))) {
          if (!new RegExp(`^(${ARRAY_METHODS}|toString|valueOf)$`).test(k[1])) itemKeys.add(k[1]);
        }
      }
      // `data.cards[0].title` style access
      for (const m of source.matchAll(new RegExp(`\\bdata\\??\\.${esc}\\??\\.?\\[\\s*\\d+\\s*\\]\\??\\.([A-Za-z_$][\\w$]*)`, "g"))) itemKeys.add(m[1]);
    }
    out[f] = { kind: kinds[f], keys: [...keys], itemKeys: [...itemKeys] };
  }
  return out;
}

/** Blank value in the inferred shape: `""`, `{ key: "" }`, or `[{ key: "" }]` (one sample item). */
export function seedValueFor(shape: FieldShape): unknown {
  if (shape.kind === "object") return Object.fromEntries(shape.keys.map((k) => [k, ""]));
  if (shape.kind === "array") return shape.itemKeys.length ? [Object.fromEntries(shape.itemKeys.map((k) => [k, k === "id" ? "item-1" : ""]))] : [];
  return "";
}
