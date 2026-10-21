import { visibleItemKeys } from "./editorDetailFields";

/**
 * Rename content keys to the vocabulary the host section editor understands, consistently in the
 * component source, `defaultContent` and `editorFields`.
 *
 * Why: the host editor (EditSectionModal) picks controls and labels by key name — `title`,
 * `titleHighlight`, `subtitle`, `pretitle`, `desc`/`description`, `image`/`…Image`, `href|link|url`,
 * `faqItems`, `galleryItems`, `whyChooseUsItems`, `stats`, `testimonials`, `awardItems`, `steps` … —
 * while source repositories use their own (`title_line1`, `img`, `faqs`, `items`).
 *
 * Safety rules (a key is left alone, with a reason, when any fails):
 *  - the key must occur in this component's content (any depth) or editorFields;
 *  - the rename target must be a valid identifier and must not already exist in any object that
 *    holds the key (no collisions), nor be itself a key that is being renamed;
 *  - section-specific collection renames (`items` -> `galleryItems`) apply only when the key occurs
 *    at the top level only, so a nested `sidebar.items` is never caught by them.
 * Code rewriting touches property access (`.k`, `?.k`, `["k"]`), object/destructuring keys
 * (`{ k }` -> `{ k2: k }`, `k:` -> `k2:`) and nothing else, so local variables keep their names.
 */

export interface FieldAliasConfig {
  enabled: boolean;
  /** snake_case / kebab-case keys -> camelCase (title_line1 -> titleLine1) */
  camelCase: boolean;
  /** generic key renames applied at any depth */
  fields: Record<string, string>;
  /** top-level-only renames per host section type (Gallery: items -> galleryItems) */
  bySectionType: Record<string, Record<string, string>>;
}

export interface FieldAliasResult {
  code: string;
  content: Record<string, unknown>;
  editorFields: string[];
  renamed: { from: string; to: string; occurrences: number }[];
  skipped: { key: string; to: string; reason: string }[];
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

const INTERNAL_ITEM_KEYS = new Set(["id", "slug", "key", "_id", "__typename"]);

const STRING_TARGETS = new Set(["title", "titleHighlight", "subtitle", "pretitle", "description", "desc", "image", "backgroundImage", "logoImage", "copyrightText", "buttonText", "buttonUrl", "sideImage"]);
const ARRAY_TARGETS = new Set(["galleryItems", "whyChooseUsItems", "stats", "faqItems", "testimonials", "awardItems", "steps", "features", "members", "partners", "menu", "socialLinks", "footerColumns", "buttons"]);
const OBJECT_TARGETS = new Set(["button"]);

function expectedKind(target: string): "string" | "array" | "object" | null {
  if (STRING_TARGETS.has(target)) return "string";
  if (ARRAY_TARGETS.has(target)) return "array";
  if (OBJECT_TARGETS.has(target)) return "object";
  return null;
}

export function toCamelCase(key: string): string {
  if (!/[_-]/.test(key)) return key;
  const parts = key.split(/[_-]+/).filter(Boolean);
  if (!parts.length) return key;
  return parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every object (incl. array items) in the content tree, with depth 0 = the content root. */
function collectObjects(value: unknown, depth: number, out: { obj: Record<string, unknown>; depth: number }[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectObjects(v, depth, out);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    out.push({ obj, depth });
    for (const v of Object.values(obj)) collectObjects(v, depth + 1, out);
  }
}

function renameKeysDeep(value: unknown, map: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => renameKeysDeep(v, map));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[map.get(k) ?? k] = renameKeysDeep(v, map);
    return out;
  }
  return value;
}

/**
 * Brace groups that are object literals / destructuring patterns / type literals, as
 * [open, close] index pairs. JSX expression containers (`>{x}<`, `attr={x}`) and blocks are excluded
 * so a local variable rendered as `{title_line1}` is never mistaken for a shorthand key.
 */
export interface BraceGroup {
  open: number;
  close: number;
  isObject: boolean;
}

export function braceGroups(code: string): BraceGroup[] {
  const groups: BraceGroup[] = [];
  const stack: { open: number; isObject: boolean }[] = [];
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      else if (quote === "`" && ch === "$" && code[i + 1] === "{") {
        // template expression: treat as a block
        stack.push({ open: i + 1, isObject: false });
        i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      i = nl < 0 ? code.length : nl;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? code.length : end + 1;
      continue;
    }
    if (ch === "{") {
      let j = i - 1;
      while (j >= 0 && /\s/.test(code[j])) j--;
      const prev = j >= 0 ? code[j] : "";
      const prev2 = j >= 1 ? code[j - 1] + prev : prev;
      let isObject = false;
      if (prev2 === "=>") isObject = false; // arrow body block (object-returning arrows use parens)
      else if (prev === ">") isObject = false; // JSX child
      else if (prev === "=") {
        // `attr={x}` (JSX, no space, identifier before `=`) vs `const a = {…}`
        const noSpace = j === i - 1;
        const identBefore = j >= 1 && /[\w$"'\]]/.test(code[j - 1]);
        isObject = !(noSpace && identBefore);
      }       else if (/[(,:\[?|&!]/.test(prev)) isObject = true;
      else if (prev === "{") isObject = true; // `attr={{ … }}` / `{{ … }}`: object literal inside a JSX container
      else if (prev === "}" || prev === ")" || prev === ";" || prev === "") isObject = false; // blocks
      else if (/[\w$]/.test(prev)) {
        // `return {`, `typeof {`, `in {`, `of {`, `as {` are objects/types; `else {`, `try {`, `do {` are blocks.
        const word = code.slice(0, j + 1).match(/[\w$]+$/)?.[0] ?? "";
        isObject = /^(const|let|var|return|typeof|in|of|as|satisfies|extends|implements|await|yield|export|default|import)$/.test(word);
      }
      stack.push({ open: i, isObject });
      continue;
    }
    if (ch === "}") {
      const top = stack.pop();
      if (top) groups.push({ open: top.open, close: i, isObject: top.isObject });
    }
  }
  return groups;
}

/** The innermost brace group containing `pos` (the position of a `{` or `,`). */
function groupAt(groups: BraceGroup[], pos: number, isOpenBrace: boolean): BraceGroup | undefined {
  if (isOpenBrace) return groups.find((g) => g.open === pos);
  let best: BraceGroup | undefined;
  for (const g of groups) {
    if (g.open < pos && pos < g.close && (!best || g.open > best.open)) best = g;
  }
  return best;
}

function renameKeyInCode(code: string, from: string, to: string): { code: string; count: number } {
  const k = escapeRe(from);
  let count = 0;
  const bump = (s: string) => {
    count += 1;
    return s;
  };
  // obj.k / obj?.k  (not a call: data.k( would be a method)
  code = code.replace(new RegExp(`(\\.|\\?\\.)${k}\\b(?![\\w$]|\\s*\\()`, "g"), (_m, dot: string) => bump(`${dot}${to}`));
  // obj["k"] / obj?.["k"]
  code = code.replace(new RegExp(`\\[\\s*(["'])${k}\\1\\s*\\]`, "g"), (_m, q: string) => bump(`[${q}${to}${q}]`));
  // keys inside object / destructuring / type braces: `{ k: … }`, `{ k }`, `{ k = d }`, `{ k?: T }`
  const groups = braceGroups(code);
  const keyRe = new RegExp(`([{,;]\\s*)${k}(?=\\s*(?::(?!:)|[,;}]|=(?!=)|\\?\\s*:))`, "g");
  code = code.replace(keyRe, (m: string, pre: string, offset: number) => {
    const g = groupAt(groups, offset, pre[0] === "{");
    if (!g?.isObject) return m; // block / JSX expression container: a local variable, not a key
    const after = code.slice(offset + m.length).trimStart();
    return bump(after.startsWith(":") || after.startsWith("?") ? `${pre}${to}` : `${pre}${to}: ${from}`);
  });
  return { code, count };
}

export function applyFieldAliases(
  code: string,
  content: Record<string, unknown>,
  editorFields: string[],
  sectionType: string,
  cfg: FieldAliasConfig,
): FieldAliasResult {
  const renamed: FieldAliasResult["renamed"] = [];
  const skipped: FieldAliasResult["skipped"] = [];
  if (!cfg.enabled) return { code, content, editorFields, renamed, skipped };

  const objects: { obj: Record<string, unknown>; depth: number }[] = [];
  collectObjects(content, 0, objects);
  const keyDepths = new Map<string, Set<number>>();
  for (const { obj, depth } of objects) for (const k of Object.keys(obj)) (keyDepths.get(k) ?? keyDepths.set(k, new Set()).get(k)!).add(depth);
  for (const f of editorFields) (keyDepths.get(f) ?? keyDepths.set(f, new Set()).get(f)!).add(0);

  const sectionMap = cfg.bySectionType[sectionType] ?? {};
  const plan = new Map<string, string>();
  for (const [key, depths] of keyDepths) {
    let to: string | undefined;
    if (sectionMap[key] !== undefined) {
      if (depths.size === 1 && depths.has(0)) to = sectionMap[key];
      else {
        skipped.push({ key, to: sectionMap[key], reason: "also used as a nested key; section rename needs a top-level-only key" });
        continue;
      }
    }
    to ??= cfg.fields[key];
    if (to === undefined && cfg.camelCase) {
      // camelCase first, then let the alias table act on the result in the same hop
      // (title_line1 -> titleLine1 -> title) so no chained renames are needed.
      const camel = toCamelCase(key);
      to = sectionMap[camel] ?? cfg.fields[camel] ?? camel;
    }
    if (to === undefined || to === key) continue;
    if (!IDENT.test(to)) {
      skipped.push({ key, to, reason: "target is not a valid identifier" });
      continue;
    }
    plan.set(key, to);
  }
  // No chains (a -> b while b -> c) and no two keys collapsing into one target.
  const targets = new Map<string, string>();
  for (const [key, to] of [...plan]) {
    if (plan.has(to)) {
      plan.delete(key);
      skipped.push({ key, to, reason: `target "${to}" is itself being renamed` });
      continue;
    }
    const other = targets.get(to);
    if (other) {
      plan.delete(key);
      plan.delete(other);
      skipped.push({ key, to, reason: `both "${key}" and "${other}" would become "${to}"` });
      continue;
    }
    targets.set(to, key);
  }
  // No collisions: an object that has the key must not already have the target.
  for (const [key, to] of [...plan]) {
    if (objects.some(({ obj }) => key in obj && to in obj)) {
      plan.delete(key);
      skipped.push({ key, to, reason: `an object already has a "${to}" key` });
    }
  }
  // Value kind must fit what the host expects under the target name (a string under
  // `backgroundImage`, a list under `galleryItems`, an object under `button`).
  for (const [key, to] of [...plan]) {
    const expected = expectedKind(to);
    if (!expected) continue;
    const values = objects.filter(({ obj }) => key in obj).map(({ obj }) => obj[key]);
    const ok = values.every((v) => (expected === "string" ? typeof v === "string" : expected === "array" ? Array.isArray(v) : v && typeof v === "object" && !Array.isArray(v)));
    if (!ok) {
      plan.delete(key);
      skipped.push({ key, to, reason: `"${to}" expects ${expected === "array" ? "a list" : expected === "object" ? "an object" : "a string"} but the value is not` });
    }
  }
  // The section popup drops child keys that are not in its detail schema (Process steps
  // keep desc, not description; FAQ items keep question/answer). Renaming onto that
  // collection would hide the fields the component actually paints.
  for (const [key, to] of [...plan]) {
    const visible = visibleItemKeys(sectionType, to);
    if (!visible) continue;
    const hidden = new Set<string>();
    for (const { obj } of objects) {
      const value = obj[key];
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        for (const child of Object.keys(item as Record<string, unknown>)) {
          if (!visible.has(child) && !INTERNAL_ITEM_KEYS.has(child)) hidden.add(child);
        }
      }
    }
    if (hidden.size) {
      plan.delete(key);
      skipped.push({ key, to, reason: `the editor popup hides ${[...hidden].join(", ")} on "${to}" items` });
    }
  }
  if (!plan.size) return { code, content, editorFields, renamed, skipped };

  // Longest keys first so `title_line1` is rewritten before a hypothetical `title`.
  const ordered = [...plan].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of ordered) {
    const r = renameKeyInCode(code, from, to);
    code = r.code;
    renamed.push({ from, to, occurrences: r.count });
  }
  const map = new Map(plan);
  const newContent = renameKeysDeep(content, map) as Record<string, unknown>;
  const newFields = editorFields.map((f) => map.get(f) ?? f);
  return { code, content: newContent, editorFields: newFields, renamed, skipped };
}
