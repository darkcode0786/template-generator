/**
 * EditSectionModal picks each popup input from the field name, and some lists only
 * show a fixed set of child keys. This pass rewrites `defaultContent` and the
 * component so both use those names:
 *
 *   menu / navLinksLeft / navLinksRight → label, url, optional subLinks
 *   contactButton → text, url
 *   socialLinks → icon, url
 *   button / cta → text, href, icon, iconPosition
 *   stats → icon, value, title, suffix, desc
 *   faqItems → question, answer
 *   testimonials → image, name, designation, rating, message
 *   formFields → label, type, placeholder
 *   features / steps → icon, title, desc
 *   members → image, name, role, bio, social
 *   contactItems → icon, label, value, value2, href
 *
 * `logoText`, `*Title`, `*Label` and `*Alt` stay text. `logo` stays an image.
 */

export interface DetailAlignResult {
  code: string;
  content: Record<string, unknown>;
  editorFields: string[];
  renamed: { from: string; to: string; occurrences: number }[];
}

const INTERNAL_ITEM_KEYS = new Set(["id", "slug", "key", "_id", "__typename"]);

/**
 * Child keys the popup keeps for a collection. `null` means every key is shown.
 * `id` is omitted here; callers treat internal keys as harmless.
 */
export function visibleItemKeys(sectionType: string, collection: string): Set<string> | null {
  if (collection === "faqItems") return new Set(["question", "answer"]);
  if (collection === "formFields") {
    return sectionType === "CareerJobs" ? new Set(["label", "type", "placeholder", "name"]) : new Set(["label", "type", "placeholder"]);
  }
  if (collection === "promises") return new Set(["title"]);
  if (sectionType === "Process" && collection === "steps") return new Set(["icon", "title", "desc", "image"]);
  if (sectionType === "Awards" && collection === "awardItems") return new Set(["image", "year", "title", "org", "alt"]);
  if (sectionType === "AwardsPage" && collection === "awardItems") return new Set(["image", "year", "org", "title", "desc"]);
  if (sectionType === "Stats" && (collection === "stats" || collection === "achievements")) {
    return new Set(["stat", "label", "value", "count", "number", "title", "icon", "suffix", "symbol", "desc"]);
  }
  if (sectionType === "FeaturedDev" && collection === "items") return new Set(["image", "alt"]);
  if (sectionType === "InvestmentOpportunities" && collection === "items") {
    return new Set(["image", "alt", "title", "location", "yieldLabel", "desc", "href"]);
  }
  if (sectionType === "MissionPage" && collection === "pillars") return new Set(["title", "desc"]);
  if (sectionType === "MissionValues" && collection === "values") return new Set(["icon", "title", "desc"]);
  if (sectionType === "CsrPage" && collection === "impactStats") return new Set(["stat", "label"]);
  if (sectionType === "CsrPrograms" && collection === "programs") return new Set(["image", "amount", "title", "desc"]);
  if (sectionType === "CareerPage" && collection === "benefits") return new Set(["title", "desc"]);
  if (sectionType === "CareerJobs" && collection === "jobs") return new Set(["title", "location", "type", "desc"]);
  return null;
}

interface ItemKeyMap {
  /** When set, the map applies only for these section types. */
  sectionTypes?: string[];
  collections: string[];
  /** Source child key -> popup child key. Applied only when the target is absent. */
  map: Record<string, string>;
  /** Skip items that look like cards (image / slug) rather than the filtered detail shape. */
  skipCardItems?: boolean;
}

const ITEM_KEY_MAPS: ItemKeyMap[] = [
  {
    collections: ["steps", "features", "whyChooseUsItems"],
    map: { description: "desc", text: "desc", content: "desc" },
  },
  {
    collections: ["stats", "achievements"],
    map: { description: "desc", content: "desc", text: "title" },
  },
  {
    collections: ["faqItems"],
    map: { title: "question", q: "question", description: "answer", content: "answer", a: "answer" },
    skipCardItems: true,
  },
  {
    collections: ["testimonials", "testimonialItems"],
    map: {
      quote: "message",
      text: "message",
      content: "message",
      review: "message",
      description: "message",
      role: "designation",
      position: "designation",
      photo: "image",
      avatar: "image",
      img: "image",
      picture: "image",
      thumbnail: "image",
    },
  },
  {
    collections: ["formFields"],
    map: { title: "label", description: "placeholder", text: "placeholder" },
  },
  {
    collections: ["members"],
    map: {
      photo: "image",
      avatar: "image",
      img: "image",
      picture: "image",
      description: "bio",
      text: "bio",
      about: "bio",
      content: "bio",
      designation: "role",
      position: "role",
      socials: "social",
      socialLinks: "social",
    },
  },
  {
    collections: ["contactItems"],
    map: { url: "href", link: "href", uri: "href", phone: "value", email: "value2" },
  },
  {
    sectionTypes: ["AwardsPage"],
    collections: ["awardItems"],
    map: { description: "desc", text: "desc" },
  },
  {
    sectionTypes: ["MissionPage"],
    collections: ["pillars"],
    map: { description: "desc", text: "desc" },
  },
  {
    sectionTypes: ["MissionValues", "CareerPage"],
    collections: ["values", "benefits"],
    map: { description: "desc", text: "desc" },
  },
  {
    sectionTypes: ["CareerJobs", "CsrPrograms", "InvestmentOpportunities"],
    collections: ["jobs", "programs", "items"],
    map: { description: "desc", text: "desc" },
  },
];

/** Object fields the popup edits as one control group, not a list. */
const OBJECT_KEY_MAPS: { keys: string[]; map: Record<string, string>; ensureIconPosition?: boolean }[] = [
  { keys: ["contactButton"], map: { label: "text", title: "text", href: "url", link: "url", uri: "url" } },
  {
    keys: ["button", "cta", "button1", "button2", "primaryButton", "secondaryButton"],
    map: { label: "text", title: "text", url: "href", link: "href", uri: "href", buttonIcon: "icon" },
    ensureIconPosition: true,
  },
];

const NAV_KEYS = ["navLinks", "navItems", "menuItems", "navigation", "links", "menu"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function looksLikeCard(item: Record<string, unknown>): boolean {
  return ["image", "slug", "icon", "linkUrl", "linkText"].some((key) => key in item);
}

interface MapCall {
  receiver: string;
  param: string;
  /** Index of the callback argument inside the source (params + body). */
  argStart: number;
  argEnd: number;
  paramsStart: number;
  paramsEnd: number;
  bodyStart: number;
  bodyEnd: number;
}

function matchParen(code: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `.map` / `.forEach` / `.flatMap` calls, with the callback parameter name. */
function mapCalls(code: string): MapCall[] {
  const out: MapCall[] = [];
  const re = /([A-Za-z_$][\w$]*(?:\s*\?\.\s*[A-Za-z_$][\w$]*|\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\??\.\s*(?:map|forEach|flatMap)\s*\(/g;
  for (const m of code.matchAll(re)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const close = matchParen(code, open);
    if (close < 0) continue;
    const args = code.slice(open + 1, close);
    const trimmed = args.trimStart();
    const pad = args.length - trimmed.length;
    let param = "";
    let paramsStart = open + 1 + pad;
    let paramsEnd = paramsStart;
    let bodyStart = paramsStart;
    if (trimmed.startsWith("(")) {
      const innerOpen = paramsStart;
      const innerClose = matchParen(code, innerOpen);
      if (innerClose < 0 || innerClose > close) continue;
      const params = code.slice(innerOpen + 1, innerClose).trim();
      param = params.startsWith("{") ? "" : (params.split(",")[0]?.trim().split(/[:?=]/)[0]?.trim() ?? "");
      paramsStart = innerOpen + 1;
      paramsEnd = innerClose;
      bodyStart = innerClose + 1;
    } else {
      const ident = /^([A-Za-z_$][\w$]*)/.exec(trimmed);
      if (!ident) continue;
      param = ident[1];
      paramsEnd = paramsStart + ident[1].length;
      bodyStart = paramsEnd;
    }
    if (param && !/^[A-Za-z_$][\w$]*$/.test(param)) param = "";
    out.push({
      receiver: m[1].replace(/\s/g, ""),
      param,
      argStart: open + 1,
      argEnd: close,
      paramsStart,
      paramsEnd,
      bodyStart,
      bodyEnd: close,
    });
  }
  return out;
}

function receiverMatches(receiver: string, collection: string): boolean {
  const norm = receiver.replace(/\?/g, "");
  return norm === collection || norm === `data.${collection}` || norm.endsWith(`.${collection}`);
}

function rewriteMember(body: string, param: string, from: string, to: string): { body: string; count: number } {
  if (!param) return { body, count: 0 };
  let count = 0;
  const dot = new RegExp(`\\b${param}(\\?)?\\.${from}\\b`, "g");
  let next = body.replace(dot, (_m, opt: string | undefined) => {
    count += 1;
    return `${param}${opt ?? ""}.${to}`;
  });
  const bracket = new RegExp(`\\b${param}(\\?\\.)?\\[\\s*(["'])${from}\\2\\s*\\]`, "g");
  next = next.replace(bracket, (_m, opt: string | undefined, q: string) => {
    count += 1;
    return `${param}${opt ?? ""}[${q}${to}${q}]`;
  });
  return { body: next, count };
}

/** `{ description }` -> `{ desc: description }` inside a callback parameter list, so the local name stays. */
function rewriteParamShorthand(params: string, from: string, to: string): { params: string; count: number } {
  const re = new RegExp(`([{,]\\s*)${from}(?=\\s*[,}=])`, "g");
  let count = 0;
  const next = params.replace(re, (_m, pre: string) => {
    count += 1;
    return `${pre}${to}: ${from}`;
  });
  return { params: next, count };
}

function patchMapMembers(code: string, collection: string, keyMap: Record<string, string>, special?: (param: string, body: string) => { body: string; count: number }): { code: string; count: number } {
  const calls = mapCalls(code).filter((call) => receiverMatches(call.receiver, collection));
  if (!calls.length) return { code, count: 0 };
  let count = 0;
  const pieces: { start: number; end: number; text: string }[] = [];
  for (const call of calls) {
    let body = code.slice(call.bodyStart, call.bodyEnd);
    if (call.param) {
      for (const [from, to] of Object.entries(keyMap).sort((a, b) => b[0].length - a[0].length)) {
        const r = rewriteMember(body, call.param, from, to);
        body = r.body;
        count += r.count;
      }
      if (special) {
        const r = special(call.param, body);
        body = r.body;
        count += r.count;
      }
    }
    // Nested maps (dropdown items) live in the body; rewrite their url/href after the parent pass
    // by running the same key map against every map inside the already-extracted body.
    const nested = mapCalls(body);
    if (nested.length) {
      const nestedPieces: { start: number; end: number; text: string }[] = [];
      for (const inner of nested) {
        if (!inner.param) continue;
        let innerBody = body.slice(inner.bodyStart, inner.bodyEnd);
        for (const [from, to] of Object.entries(keyMap)) {
          const r = rewriteMember(innerBody, inner.param, from, to);
          innerBody = r.body;
          count += r.count;
        }
        if (innerBody !== body.slice(inner.bodyStart, inner.bodyEnd)) {
          nestedPieces.push({ start: inner.bodyStart, end: inner.bodyEnd, text: innerBody });
        }
      }
      for (const piece of nestedPieces.sort((a, b) => b.start - a.start)) {
        body = body.slice(0, piece.start) + piece.text + body.slice(piece.end);
      }
    }
    let params = code.slice(call.paramsStart, call.paramsEnd);
    for (const [from, to] of Object.entries(keyMap)) {
      const r = rewriteParamShorthand(params, from, to);
      params = r.params;
      count += r.count;
    }
    if (body !== code.slice(call.bodyStart, call.bodyEnd)) {
      pieces.push({ start: call.bodyStart, end: call.bodyEnd, text: body });
    }
    if (params !== code.slice(call.paramsStart, call.paramsEnd)) {
      pieces.push({ start: call.paramsStart, end: call.paramsEnd, text: params });
    }
  }
  for (const piece of pieces.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, piece.start) + piece.text + code.slice(piece.end);
  }
  return { code, count };
}

function renameDataKey(code: string, from: string, to: string): { code: string; count: number } {
  let count = 0;
  const bump = (next: string) => {
    count += 1;
    return next;
  };
  code = code.replace(new RegExp(`\\bdata(\\??\\.)${from}\\b`, "g"), (_m, dot: string) => bump(`data${dot}${to}`));
  code = code.replace(new RegExp(`\\bdata\\??\\[\\s*(["'])${from}\\1\\s*\\]`, "g"), (_m, q: string) => bump(`data[${q}${to}${q}]`));
  // `const { navLinks } = data` / `({ navLinks } = data)` keeps the local name.
  code = code.replace(new RegExp(`([{,]\\s*)${from}(?=\\s*[,}])(?=[^;\\n]{0,200}=\\s*data\\b)`, "g"), (_m, pre: string) => bump(`${pre}${to}: ${from}`));
  return { code, count };
}

function replaceField(fields: string[], from: string, to: string): string[] {
  const next = fields.map((field) => (field === from ? to : field));
  return next.filter((field, index) => next.indexOf(field) === index);
}

function linkUrl(item: Record<string, unknown>): string {
  return asString(item.url || item.href || item.uri || item.link);
}

function itemId(item: Record<string, unknown>, index: number): string {
  if (typeof item.id === "string" && item.id.trim()) return item.id;
  if (typeof item.id === "number") return String(item.id);
  return `item-${index + 1}`;
}

function toLinkItem(item: Record<string, unknown>, index = 0): { id: string; label: string; url: string } {
  return { id: itemId(item, index), label: asString(item.label || item.text || item.title || item.name), url: linkUrl(item) };
}

function toMenuItem(item: Record<string, unknown>, index = 0): Record<string, unknown> {
  const raw = [item.subLinks, item.sublinks, item.dropdownItems, item.children].find(Array.isArray) as unknown[] | undefined;
  const subLinks = raw?.filter(isRecord).map((child, childIndex) => toLinkItem(child, childIndex)) ?? [];
  const link = toLinkItem(item, index);
  const next: Record<string, unknown> = { id: link.id, label: link.label, url: link.url };
  if (subLinks.length) next.subLinks = subLinks;
  return next;
}

const MENU_ITEM_KEYS: Record<string, string> = {
  href: "url",
  uri: "url",
  link: "url",
  dropdownItems: "subLinks",
  children: "subLinks",
  sublinks: "subLinks",
};

function alignMenuItems(code: string, collection: string, renamed: DetailAlignResult["renamed"]): string {
  const member = patchMapMembers(code, collection, MENU_ITEM_KEYS, (param, body) => {
    const re = new RegExp(`\\b${param}(\\?)?\\.dropdown\\b`, "g");
    let count = 0;
    const next = body.replace(re, (_m, opt: string | undefined) => {
      count += 1;
      return `${param}${opt ?? ""}.subLinks?.length`;
    });
    return { body: next, count };
  });
  if (member.count) renamed.push({ from: `${collection}.href`, to: "url", occurrences: member.count });
  return member.code;
}

function alignHeaderMenu(code: string, content: Record<string, unknown>, editorFields: string[], renamed: DetailAlignResult["renamed"]): string {
  const referenced = NAV_KEYS.find(
    (key) => key !== "menu" && new RegExp(`\\bdata\\??\\.${key}\\b`).test(code) && Array.isArray(content[key]) && (content[key] as unknown[]).some(isRecord),
  );
  const sourceKey = referenced ?? NAV_KEYS.find((key) => key !== "menu" && Array.isArray(content[key]) && (content[key] as unknown[]).some(isRecord));
  const menuKey = sourceKey ?? (Array.isArray(content.menu) && (content.menu as unknown[]).some(isRecord) ? "menu" : undefined);
  if (menuKey && Array.isArray(content[menuKey])) {
    const items = (content[menuKey] as unknown[]).filter(isRecord).map((item, index) => toMenuItem(item, index));
    // Rewrite item members while the receiver is still the source name (`data.navLinks.map`).
    code = alignMenuItems(code, menuKey, renamed);
    if (menuKey !== "menu") {
      const rewritten = renameDataKey(code, menuKey, "menu");
      code = rewritten.code;
      renamed.push({ from: menuKey, to: "menu", occurrences: rewritten.count });
      delete content[menuKey];
      editorFields.splice(0, editorFields.length, ...replaceField(editorFields, menuKey, "menu"));
    }
    content.menu = items;
    if (!editorFields.includes("menu")) editorFields.push("menu");
  }
  // The content popup keeps these two lists under their own names and shows label / url / subLinks.
  for (const key of ["navLinksLeft", "navLinksRight"] as const) {
    if (!Array.isArray(content[key]) || !(content[key] as unknown[]).some(isRecord)) continue;
    code = alignMenuItems(code, key, renamed);
    content[key] = (content[key] as unknown[]).filter(isRecord).map((item, index) => toMenuItem(item, index));
  }
  return code;
}

function alignFilteredItems(code: string, content: Record<string, unknown>, sectionType: string, renamed: DetailAlignResult["renamed"]): string {
  for (const rule of ITEM_KEY_MAPS) {
    if (rule.sectionTypes && !rule.sectionTypes.includes(sectionType)) continue;
    for (const collection of rule.collections) {
      const value = content[collection];
      if (!Array.isArray(value)) continue;
      const visible = visibleItemKeys(sectionType, collection);
      let changed = 0;
      const moved = new Set<string>();
      const kept = new Set<string>();
      content[collection] = value.map((item) => {
        if (!isRecord(item)) return item;
        if (rule.skipCardItems && looksLikeCard(item)) return item;
        const next = { ...item };
        for (const [from, to] of Object.entries(rule.map)) {
          if (!(from in next) || from === to) continue;
          if (visible?.has(from)) continue;
          if (INTERNAL_ITEM_KEYS.has(from)) continue;
          const empty = next[to] === undefined || next[to] === "";
          if (!empty && next[from] !== next[to]) {
            kept.add(from);
            continue;
          }
          if (empty) next[to] = next[from];
          delete next[from];
          moved.add(from);
          changed += 1;
        }
        return next;
      });
      if (!changed) continue;
      const used = Object.fromEntries(
        Object.entries(rule.map).filter(([from, to]) => from !== to && moved.has(from) && !kept.has(from)),
      );
      const patched = patchMapMembers(code, collection, used);
      code = patched.code;
      renamed.push({ from: `${collection}.{${Object.keys(used).join(",")}}`, to: collection, occurrences: patched.count });
    }
  }
  return code;
}

const TEXT_KEY = /title|alt|label|href|text|name|url|link|icon|desc|quote|message|question|answer|button|variant|placeholder|copyright/i;

/** Same decision the popup uses: title / alt / label / href / logoText stay text. */
function popupMediaKind(key: string): "image" | "video" | null {
  const name = key.toLowerCase();
  if (/title|alt|label|href/.test(name)) return null;
  if (name.includes("text")) return null;
  if (name.includes("video")) return "video";
  if (name === "poster" || name.includes("avatar") || name.includes("photo")) return "image";
  if (name === "logo" || name.endsWith("logo")) return "image";
  const stripped = name.replace(/\d+$/, "");
  if (stripped === "image" || stripped.endsWith("image") || stripped.startsWith("image")) return "image";
  return null;
}

function looksLikeMediaPath(value: string): "image" | "video" | null {
  const path = value.trim();
  if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(path)) return "video";
  if (/\.(png|jpe?g|webp|gif|avif|svg|ico|bmp|jfif)(\?|#|$)/i.test(path)) return "image";
  if (/^(assets\/|\/images\/|\/img\/)/i.test(path)) return "image";
  return null;
}

function suggestedMediaKey(key: string, kind: "image" | "video"): string {
  const name = key.toLowerCase();
  if (kind === "video") return /bg|background/.test(name) ? "bgVideo" : "video";
  if (name.includes("logo")) return "logo";
  if (name.includes("avatar")) return "avatar";
  if (name.includes("photo")) return "photo";
  if (name.includes("poster")) return "poster";
  if (name.includes("side")) return "sideImage";
  if (/bg|background|banner/.test(name)) return "bgImage";
  if (/hero|main/.test(name)) return "imageMain";
  return "image";
}

function alignMediaKeyNames(code: string, content: Record<string, unknown>, editorFields: string[], renamed: DetailAlignResult["renamed"]): string {
  for (const key of Object.keys(content)) {
    if (popupMediaKind(key) || TEXT_KEY.test(key)) continue;
    const value = content[key];
    if (typeof value !== "string") continue;
    const kind = looksLikeMediaPath(value);
    if (!kind) continue;
    const to = suggestedMediaKey(key, kind);
    if (to === key || content[to] !== undefined) continue;
    const rewritten = renameDataKey(code, key, to);
    code = rewritten.code;
    content[to] = value;
    delete content[key];
    const index = editorFields.indexOf(key);
    if (index >= 0) editorFields.splice(index, 1, to);
    else editorFields.push(to);
    renamed.push({ from: key, to, occurrences: rewritten.count });
  }
  return code;
}

function rewriteDataMember(code: string, objectKey: string, from: string, to: string): { code: string; count: number } {
  let count = 0;
  const dot = new RegExp(`\\bdata(\\?)?\\.${objectKey}(\\?)?\\.${from}\\b`, "g");
  let next = code.replace(dot, (_match, dataOpt: string | undefined, memberOpt: string | undefined) => {
    count += 1;
    return `data${dataOpt ?? ""}.${objectKey}${memberOpt ?? ""}.${to}`;
  });
  const bracket = new RegExp(`\\bdata(\\?)?\\.${objectKey}\\??\\[(["'])${from}\\2\\]`, "g");
  next = next.replace(bracket, (_match, dataOpt: string | undefined, quote: string) => {
    count += 1;
    return `data${dataOpt ?? ""}.${objectKey}[${quote}${to}${quote}]`;
  });
  return { code: next, count };
}

function alignObjectFields(code: string, content: Record<string, unknown>, renamed: DetailAlignResult["renamed"]): string {
  for (const rule of OBJECT_KEY_MAPS) {
    for (const key of rule.keys) {
      const value = content[key];
      if (!isRecord(value)) continue;
      const next = { ...value };
      const moved: string[] = [];
      for (const [from, to] of Object.entries(rule.map)) {
        if (!(from in next) || from === to) continue;
        const empty = next[to] === undefined || next[to] === "";
        if (!empty && next[from] !== next[to]) continue;
        if (empty) next[to] = next[from];
        delete next[from];
        moved.push(from);
      }
      if (rule.ensureIconPosition && typeof next.icon === "string" && next.icon && next.iconPosition == null) next.iconPosition = "after";
      content[key] = next;
      for (const from of moved) {
        const to = rule.map[from];
        if (!to) continue;
        const rewritten = rewriteDataMember(code, key, from, to);
        code = rewritten.code;
        if (rewritten.count) renamed.push({ from: `${key}.${from}`, to, occurrences: rewritten.count });
      }
    }
  }
  return code;
}

function alignSocialLinks(code: string, content: Record<string, unknown>, renamed: DetailAlignResult["renamed"]): string {
  const value = content.socialLinks;
  if (!Array.isArray(value)) return code;
  const map: Record<string, string> = { href: "url", uri: "url", link: "url", iconName: "icon" };
  let changed = 0;
  const moved = new Set<string>();
  const kept = new Set<string>();
  content.socialLinks = value.map((item) => {
    if (!isRecord(item)) return item;
    const next = { ...item };
    for (const [from, to] of Object.entries(map)) {
      if (!(from in next) || from === to) continue;
      const empty = next[to] === undefined || next[to] === "";
      if (!empty && next[from] !== next[to]) {
        kept.add(from);
        continue;
      }
      if (empty) next[to] = next[from];
      delete next[from];
      moved.add(from);
      changed += 1;
    }
    return next;
  });
  if (!changed) return code;
  const used = Object.fromEntries(Object.entries(map).filter(([from]) => moved.has(from) && !kept.has(from)));
  const patched = patchMapMembers(code, "socialLinks", used);
  if (patched.count) renamed.push({ from: "socialLinks.href", to: "url", occurrences: patched.count });
  return patched.code;
}

export function alignEditorDetailFields(code: string, content: Record<string, unknown>, editorFields: string[], sectionType: string): DetailAlignResult {
  const renamed: DetailAlignResult["renamed"] = [];
  const fields = [...editorFields];
  if (sectionType === "Header") code = alignHeaderMenu(code, content, fields, renamed);
  code = alignFilteredItems(code, content, sectionType, renamed);
  code = alignSocialLinks(code, content, renamed);
  code = alignObjectFields(code, content, renamed);
  code = alignMediaKeyNames(code, content, fields, renamed);
  return { code, content, editorFields: fields, renamed };
}
