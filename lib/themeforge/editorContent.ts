import { extractDataFields } from "./analysis";

const BACKGROUND_FIELD = /(^bg$|bgImage|background|bannerBg|sectionBg)/i;
const CONTENT_MEDIA_FIELD = /(image|logo|photo|avatar|thumbnail|poster)/i;

/** Text first, then lists and photos, then background images. Order inside a group follows the component. */
export function orderEditorFields(fields: readonly string[], content: Record<string, unknown>): string[] {
  const rank = (name: string) => {
    if (BACKGROUND_FIELD.test(name)) return 2;
    if (CONTENT_MEDIA_FIELD.test(name) || Array.isArray(content[name])) return 1;
    return 0;
  };
  return fields
    .map((field, index) => ({ field, index, rank: rank(field) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.field);
}

/** Arrays the component walks with `.map`. Those lists can grow in the editor. */
export function mappedCollectionFields(code: string): string[] {
  const names: string[] = [];
  const add = (name: string) => {
    if (name && /^[A-Za-z_$][\w$]*$/.test(name) && !names.includes(name)) names.push(name);
  };
  for (const match of code.matchAll(/\bdata\??\.([A-Za-z_$][\w$]*)\??\.map\s*\(/g)) add(match[1]);
  for (const match of code.matchAll(/\bdata\??\.([A-Za-z_$][\w$]*)\s*(?:\|\||\?\?)\s*[\s\S]{0,40}?\.map\s*\(/g)) add(match[1]);
  for (const match of code.matchAll(/\bdata\??\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]\??\.map\s*\(/g)) add(match[1]);
  for (const match of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:props\.)?data\b/g)) {
    for (const part of match[1].split(",")) {
      const name = part.split(/[:=]/)[0]?.trim().replace(/^\.\.\./, "") ?? "";
      if (!name) continue;
      if (new RegExp(`\\b${name}\\??\\.map\\s*\\(`).test(code)) add(name);
    }
  }
  return names;
}

function usesWholeData(code: string): boolean {
  return /\{\s*\.\.\.\s*data\b/.test(code) || /\bdata=\{data\b/.test(code);
}

function callbackItemKeys(code: string, field: string): Set<string> | "all" | null {
  const re = new RegExp(`\\b(?:data\\??\\.${field}|${field})\\b[\\s\\S]{0,60}?\\.map\\s*\\(`, "g");
  const keys = new Set<string>();
  let found = false;
  for (const match of code.matchAll(re)) {
    found = true;
    const from = (match.index ?? 0) + match[0].length;
    const head = code.slice(from, from + 180);
    const params = /^\s*\(?\s*(\w+)/.exec(head);
    const item = params?.[1];
    if (!item || item === "function") return "all";
    const window = code.slice(from, from + 2500);
    if (new RegExp(`\\.\\.\\.\\s*${item}\\b`).test(window) || new RegExp(`\\b${item}\\s*[,}]`).test(window)) return "all";
    if (!new RegExp(`\\b${item}\\??\\.`).test(window) && new RegExp(`\\b${item}\\b`).test(window)) return "all";
    for (const prop of window.matchAll(new RegExp(`\\b${item}\\??\\.([A-Za-z_$][\\w$]*)`, "g"))) keys.add(prop[1]);
    for (const prop of window.matchAll(new RegExp(`\\b${item}\\??\\[\\s*["']([A-Za-z_$][\\w$]*)["']\\s*\\]`, "g"))) keys.add(prop[1]);
  }
  if (!found) return null;
  return keys;
}

/** Drop JSON keys the component never reads. Mapped items keep `id` and the props the loop uses. */
export function pruneUnreadContent(content: Record<string, unknown>, code: string): { content: Record<string, unknown>; removed: string[] } {
  if (usesWholeData(code)) return { content, removed: [] };
  const read = new Set(extractDataFields(code));
  const removed: string[] = [];
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    if (!read.has(key)) {
      removed.push(key);
      continue;
    }
    next[key] = pruneItem(key, value, code);
  }
  return { content: next, removed };
}

function pruneItem(field: string, value: unknown, code: string): unknown {
  if (!Array.isArray(value)) return value;
  const keys = callbackItemKeys(code, field);
  if (!keys || keys === "all") return value;
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    const pruned: Record<string, unknown> = {};
    if ("id" in record) pruned.id = record.id;
    for (const key of keys) if (key in record && key !== "id") pruned[key] = record[key];
    for (const key of Object.keys(record)) {
      if (key in pruned || key === "id") continue;
      if (keys.has(key)) pruned[key] = record[key];
    }
    return pruned;
  });
}
