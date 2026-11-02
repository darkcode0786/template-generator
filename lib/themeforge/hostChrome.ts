/**
 * Host editor wiring shared by every theme: template colours and fonts follow theme.json,
 * header/footer read their settings, icons follow the editor dropdowns, and carousel
 * pager buttons only show when there is something to scroll.
 */

const GENERIC_FONT = /^(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace|cursive|fantasy)$/i;

/** `const cormorant = Cormorant_Garamond({ variable: "--font-cormorant-face" })` → `--font-cormorant-face` = Cormorant Garamond. */
export function collectFontFaces(sources: Iterable<string>): Map<string, string> {
  const faces = new Map<string, string>();
  for (const source of sources) {
    if (!/next\/font\/google/.test(source)) continue;
    const imported = new Set<string>();
    for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]next\/font\/google['"]/g)) {
      for (const part of m[1]!.split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim();
        if (name) imported.add(name);
      }
    }
    for (const m of source.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      if (!imported.has(m[1]!)) continue;
      const variable = /variable\s*:\s*['"](--[\w-]+)['"]/.exec(m[2]!)?.[1];
      if (variable) faces.set(variable, m[1]!.replace(/_/g, " "));
    }
  }
  return faces;
}

/** `var(--font-cormorant-face, Georgia, serif)` → `"Cormorant Garamond", Georgia, serif`. */
export function resolveFontFaces(vars: Record<string, string>, faces: Map<string, string>): Record<string, string> {
  if (!faces.size) return vars;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    out[key] = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (full, name: string, fallback?: string) => {
      const family = faces.get(name);
      if (!family) return full;
      return fallback?.trim() ? `"${family}", ${fallback.trim()}` : `"${family}"`;
    });
  }
  return out;
}

function firstFamily(stack: string | undefined): string {
  const first = String(stack ?? "").split(",")[0]?.replace(/['"]/g, "").trim() ?? "";
  return first && !GENERIC_FONT.test(first) && !/^var\(/i.test(first) ? first : "";
}

/**
 * Template font tokens (`--font-serif`, `--font-display`) point at the editor's Heading/Body
 * fonts, so changing the font in the dashboard restyles the template text.
 */
export function linkTemplateFonts(variables: Record<string, string>): Record<string, string> {
  const heading = firstFamily(variables["--font-heading"]);
  const body = firstFamily(variables["--font-body"]);
  const out = { ...variables };
  for (const [key, value] of Object.entries(variables)) {
    if (!key.startsWith("--font-") || ["--font-heading", "--font-body", "--font-button"].includes(key)) continue;
    const family = firstFamily(value);
    if (!family) continue;
    if (family === heading) out[key] = "var(--font-heading)";
    else if (family === body) out[key] = "var(--font-body)";
  }
  return out;
}

export function templateFontFamilies(variables: Record<string, string>): string[] {
  const families = new Set<string>();
  for (const [key, value] of Object.entries(variables)) {
    if (!key.startsWith("--font-")) continue;
    const family = firstFamily(value);
    if (family && !/^(arial|helvetica|georgia|times new roman|verdana|tahoma)$/i.test(family)) families.add(family);
  }
  return [...families];
}

/** Loads the template's Google fonts and paints body/heading text with the editor font variables. */
export function themeFontBoot(families: string[]): string {
  const names = families.map((family) => encodeURIComponent(family).replace(/%20/g, "+"));
  const css = "[data-site-theme-root]{font-family:var(--font-body),sans-serif}[data-site-theme-root] :where(h1,h2,h3,h4,h5,h6){font-family:var(--font-heading),var(--font-body),serif}";
  // A family without one of the weights fails the whole request, so each family retries without weights.
  const links = names.length
    ? ` for (const family of ${JSON.stringify(names)}) { const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "https://fonts.googleapis.com/css2?family=" + family + ":wght@300;400;500;600;700&display=swap"; link.onerror = () => { link.onerror = null; link.href = "https://fonts.googleapis.com/css2?family=" + family + "&display=swap"; }; document.head.appendChild(link); }`
    : "";
  return `  if (typeof document !== "undefined" && !document.getElementById("theme-template-font-style")) {${links} const style = document.createElement("style"); style.id = "theme-template-font-style"; style.textContent = ${JSON.stringify(css)}; document.head.appendChild(style); }`;
}

const COLOR_UTILS = "bg|text|border|border-[trblxy]|ring|ring-offset|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow";
const SKIP_COLORS = new Set(["primary", "brand", "accent", "white", "black", "transparent", "current", "inherit"]);

/** `text-maroon` / `bg-page/80` use the template's @theme names, which the host Tailwind does not know. */
export function rewriteThemeUtilities(code: string, variables: Record<string, string>): string {
  const names = Object.keys(variables)
    .filter((key) => key.startsWith("--color-"))
    .map((key) => key.slice("--color-".length))
    .filter((name) => name && !SKIP_COLORS.has(name))
    .sort((a, b) => b.length - a.length);
  const fonts = Object.keys(variables)
    .filter((key) => key.startsWith("--font-"))
    .map((key) => key.slice("--font-".length))
    .filter((name) => /^[\w-]+$/.test(name))
    .sort((a, b) => b.length - a.length);
  let out = code;
  if (names.length) {
    const re = new RegExp(`(^|[\\s"'\`:{(])(${COLOR_UTILS})-(${names.map(escapeRe).join("|")})(?:\\/(\\d{1,3}|\\[[^\\]]+\\]))?(?![\\w-])`, "g");
    out = out.replace(re, (_full, lead: string, util: string, name: string, opacity?: string) => {
      const value = opacity ? `color-mix(in_srgb,var(--color-${name})_${opacity.replace(/^\[|\]$/g, "").replace(/%$/, "")}%,transparent)` : `var(--color-${name})`;
      return `${lead}${util}-[${value}]`;
    });
  }
  if (fonts.length) {
    const re = new RegExp(`(^|[\\s"'\`:{(])font-(${fonts.map(escapeRe).join("|")})(?![\\w-])`, "g");
    out = out.replace(re, (_full, lead: string, name: string) => `${lead}font-[family-name:var(--font-${name})]`);
  }
  return out;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** End index (exclusive) of the JSX opening tag that starts at `start`. */
function tagEnd(code: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < code.length; i += 1) {
    const ch = code[i]!;
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0 && code[i - 1] !== "=") return i + 1;
  }
  return -1;
}

function braceEnd(code: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i]!;
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function addHelper(code: string, helper: string, marker: string): string {
  if (code.includes(marker)) return code;
  const directive = /^(\s*['"]use client['"];?\s*\n)/.exec(code);
  if (directive) return directive[1] + helper + code.slice(directive[1]!.length);
  return helper + code;
}

function addImport(code: string, line: string): string {
  if (code.includes(line)) return code;
  const directive = /^(\s*['"]use client['"];?\s*\n)/.exec(code);
  if (directive) return directive[1] + line + code.slice(directive[1]!.length);
  return line + code;
}

const CHROME_STYLE = `function tfChromeStyle(data: any, prefix: string): Record<string, string> {
  const d = data || {};
  const style: Record<string, string> = {};
  const bg = d[prefix + "BackgroundColor"];
  const gradient = d[prefix + "GradientColor"];
  if (d[prefix + "BackgroundType"] === "gradient" && bg && gradient) style.background = \`linear-gradient(135deg, \${bg}, \${gradient})\`;
  else if (bg) style.background = bg;
  if (d[prefix + "TextColor"]) style.color = d[prefix + "TextColor"];
  return style;
}

`;

const STICKY_HEADER = `function tfHeaderRef(node: HTMLElement | null) {
  if (!node) return;
  const host = (node.closest("[data-section-type]") as HTMLElement | null) || node;
  const sticky = node.getAttribute("data-tf-header-type") !== "scroll";
  const overlay = node.hasAttribute("data-tf-overlay");
  host.style.position = sticky ? "sticky" : overlay ? "relative" : "";
  host.style.top = sticky ? "0px" : "";
  host.style.zIndex = sticky || overlay ? "50" : "";
  host.style.marginBottom = overlay ? \`-\${node.offsetHeight}px\` : "";
}

`;

/** Applies `style={...}` and extra attributes to the first `<TAG` opening tag. */
function decorateRootTag(code: string, tag: string, styleExpr: string, extra: (attrs: string) => string): string {
  const at = code.search(new RegExp(`<${tag}(?=[\\s>])`));
  if (at < 0) return code;
  const end = tagEnd(code, at);
  if (end < 0) return code;
  let attrs = code.slice(at + tag.length + 1, end - 1);
  const selfClosing = attrs.trimEnd().endsWith("/");
  if (selfClosing) attrs = attrs.replace(/\/\s*$/, "");
  const styleAt = attrs.search(/\bstyle=\{/);
  if (styleAt >= 0) {
    const open = attrs.indexOf("{", styleAt);
    const close = braceEnd(attrs, open);
    if (close < 0) return code;
    const inner = attrs.slice(open + 1, close).trim();
    attrs = `${attrs.slice(0, styleAt)}style={{ ...(${inner}), ...${styleExpr} }}${attrs.slice(close + 1)}`;
  } else {
    attrs = `${attrs} style={${styleExpr}}`;
  }
  attrs = extra(attrs);
  return `${code.slice(0, at)}<${tag}${attrs}${selfClosing ? " /" : ""}>${code.slice(end)}`;
}

/** Header follows the editor header settings and stays sticky unless `headerType` is "scroll". */
export function applyHeaderSettings(code: string): string {
  if (!/<header(?=[\s>])/.test(code) || code.includes("tfHeaderRef") || !/\bdata\b/.test(code)) return code;
  let out = decorateRootTag(code, "header", `tfChromeStyle(data, "header")`, (attrs) => {
    const overlay = /className=[^>]*?(^|[\s"'`])(fixed|absolute)(?=[\s"'`])/.test(attrs);
    let next = attrs.replace(/(className=(?:"|\{`|\{"|'))([^"'`]*)/, (_m, lead: string, cls: string) => lead + cls.replace(/(^|\s)(fixed|sticky|absolute)(?=\s|$)/g, "$1relative"));
    next += ` data-tf-header-type={data?.headerType ?? "sticky"}`;
    if (overlay) next += ` data-tf-overlay=""`;
    if (!/\bref=\{/.test(attrs)) next += ` ref={(node) => tfHeaderRef(node)}`;
    return next;
  });
  if (out === code) return code;
  out = addHelper(out, STICKY_HEADER, "function tfHeaderRef");
  return addHelper(out, CHROME_STYLE, "function tfChromeStyle");
}

export function applyFooterSettings(code: string): string {
  if (!/<footer(?=[\s>])/.test(code) || code.includes(`tfChromeStyle(data, "footer")`) || !/\bdata\b/.test(code)) return code;
  const out = decorateRootTag(code, "footer", `tfChromeStyle(data, "footer")`, (attrs) => attrs);
  if (out === code) return code;
  return addHelper(out, CHROME_STYLE, "function tfChromeStyle");
}

const PAGER = `function tfPagerRef(node: HTMLElement | null) {
  if (!node || typeof window === "undefined") return;
  const scope = (node.closest("[data-section-type]") || node.closest("section") || node.parentElement) as HTMLElement | null;
  if (!scope || scope.dataset.tfPager) return;
  scope.dataset.tfPager = "1";
  const update = () => {
    const overflow = Array.from(scope.querySelectorAll<HTMLElement>("*")).some(
      (el) => !el.closest("[data-tf-pager]") && el.children.length > 1 && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== "visible",
    );
    scope.querySelectorAll<HTMLElement>("[data-tf-pager]").forEach((button) => {
      button.style.display = overflow ? "" : "none";
    });
  };
  window.requestAnimationFrame(update);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(update).observe(scope);
  new MutationObserver(update).observe(scope, { childList: true, subtree: true });
}

`;

const PAGER_HINT = /(aria-label=["'{][^>]*\b(prev|previous|next|scroll left|scroll right)\b)|onClick=\{[^}]*\b(prev|next|previous|scrollPrev|scrollNext|goPrev|goNext|slidePrev|slideNext)\w*/i;
const PAGER_CHILD = /^\s*(?:<[^>]*>\s*)*<(Chevron|Arrow|FiChevron|FiArrow|FaChevron|FaArrow|IoChevron|IoArrow|HiChevron|HiArrow|MdChevron|MdArrow|BsChevron|BsArrow)\w*(Left|Right|Back|Forward)\b/;

/** Prev/next carousel buttons hide when no row in the section is wider than its box. */
export function applyPagerVisibility(code: string): string {
  if (code.includes("tfPagerRef")) return code;
  const edits: { at: number; text: string }[] = [];
  for (const m of code.matchAll(/<button(?=[\s>])/g)) {
    const at = m.index ?? 0;
    const end = tagEnd(code, at);
    if (end < 0) continue;
    const attrs = code.slice(at, end);
    if (/\bref=\{/.test(attrs) || /data-tf-pager/.test(attrs)) continue;
    if (!PAGER_HINT.test(attrs) && !PAGER_CHILD.test(code.slice(end, end + 200))) continue;
    edits.push({ at: at + "<button".length, text: ` data-tf-pager="" ref={tfPagerRef}` });
  }
  if (!edits.length) return code;
  let out = code;
  for (const edit of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  return addHelper(out, PAGER, "function tfPagerRef");
}

// ---------------------------------------------------------------------------------------------
// Icons

type Callback = { item: string; bodyStart: number; bodyEnd: number; collection: string };

function mapCallbacks(code: string): Callback[] {
  const out: Callback[] = [];
  const re = /([A-Za-z_$][\w$?.]*)\s*(?:(?:\?\?|\|\|)\s*\[\]\s*)?\)?\s*\??\.map\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?:,\s*[A-Za-z_$][\w$]*\s*)?(?::\s*[^)=]+)?\)?\s*=>\s*/g;
  for (const m of code.matchAll(re)) {
    const bodyStart = (m.index ?? 0) + m[0].length;
    const opener = code[bodyStart];
    let bodyEnd = -1;
    if (opener === "{") bodyEnd = braceEnd(code, bodyStart);
    else if (opener === "(") bodyEnd = parenEnd(code, bodyStart);
    else bodyEnd = parenEnd(code, bodyStart - 1, true);
    if (bodyEnd <= bodyStart) continue;
    const collection = m[1]!.split(/\??\./).filter(Boolean).pop() ?? "";
    out.push({ item: m[2]!, bodyStart, bodyEnd, collection });
  }
  return out;
}

function parenEnd(code: string, open: number, untilClose = false): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = untilClose ? open + 1 : open; i < code.length; i += 1) {
    const ch = code[i]!;
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (untilClose && depth === 0) return i;
      depth -= 1;
      if (!untilClose && depth === 0) return i + 1;
    }
  }
  return -1;
}

function jsxClass(element: string): string | null {
  return /className=(?:"([^"]*)"|\{\s*["'`]([^"'`$]*)["'`]\s*\})/.exec(element)?.slice(1).find((v) => v !== undefined) ?? null;
}

/** Self-closing `<Name ... />` elements inside [start, end). */
function selfClosingElements(code: string, start: number, end: number, name: string): { at: number; end: number }[] {
  const found: { at: number; end: number }[] = [];
  const re = new RegExp(`<${escapeRe(name)}(?=[\\s/>])`, "g");
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) && m.index < end) {
    const close = tagEnd(code, m.index);
    if (close < 0 || close > end || code[close - 2] !== "/") continue;
    found.push({ at: m.index, end: close });
  }
  return found;
}

function jsxChildContext(code: string, at: number): boolean {
  return /[>}]$/.test(code.slice(0, at).trimEnd());
}

type Wrap = { start: number; end: number; text: string };

function wrapElements(code: string, cb: Callback, value: string, helper: string, elementNames: string[], wraps: Wrap[]) {
  for (const name of elementNames) {
    for (const el of selfClosingElements(code, cb.bodyStart, cb.bodyEnd, name)) {
      const element = code.slice(el.at, el.end);
      const cls = jsxClass(element);
      const call = `${helper}(${value}, ${element}, ${JSON.stringify(cls ?? "h-[1em] w-[1em]")})`;
      wraps.push({ start: el.at, end: el.end, text: jsxChildContext(code, el.at) ? `{${call}}` : call });
    }
  }
}

const ICON_KEYS = ["icon", "iconName", "mainIcon", "subIcon"];

function collectIconDefaults(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) value.forEach((item) => collectIconDefaults(item, into));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (ICON_KEYS.includes(key) && typeof child === "string" && child) into.add(child);
      else collectIconDefaults(child, into);
    }
  }
}

const SECTION_ICON = (defaults: string[]) => `const TF_ICON_DEFAULTS = new Set<string>(${JSON.stringify(defaults)});

function tfIcon(value: unknown, fallback: React.ReactNode, className: string): React.ReactNode {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || TF_ICON_DEFAULTS.has(raw)) return fallback;
  if (eventsIconMap[raw]) return renderEventsIcon(raw, className);
  const name = preferredWebsiteIconName(raw);
  return name ? <WebsiteIcon name={name} className={className} /> : fallback;
}

`;

/**
 * Collections whose items carry an icon key render the editor's choice once it changes.
 * The template glyph stays for the template's own values.
 */
export function wrapSectionIcons(code: string, content: Record<string, unknown>, sectionType: string): string {
  if (code.includes("function tfIcon")) return code;
  const wraps: Wrap[] = [];
  for (const cb of mapCallbacks(code)) {
    if (cb.collection === "socialLinks") continue;
    const ref = new RegExp(`\\b${escapeRe(cb.item)}\\??\\.(${ICON_KEYS.join("|")})\\b(?![\\w$])`);
    const body = code.slice(cb.bodyStart, cb.bodyEnd);
    const hit = ref.exec(body);
    if (!hit) continue;
    const value = `${cb.item}?.${hit[1]}`;
    const locals = [...body.matchAll(new RegExp(`(?:const|let)\\s+([A-Z][\\w$]*)\\s*=\\s*[^;\\n]*\\b${escapeRe(cb.item)}\\??\\.${hit[1]}\\b`, "g"))].map((m) => m[1]!);
    wrapElements(code, cb, value, "tfIcon", locals, wraps);
    if (locals.length) continue;
    const attr = new RegExp(`<([A-Z][\\w$.]*)\\b[^<>]*=\\{\\s*${escapeRe(cb.item)}\\??\\.${hit[1]}\\s*\\}[^<>]*/>`, "g");
    for (const m of body.matchAll(attr)) {
      const at = cb.bodyStart + (m.index ?? 0);
      const element = m[0];
      const call = `tfIcon(${value}, ${element}, ${JSON.stringify(jsxClass(element) ?? "h-[1em] w-[1em]")})`;
      wraps.push({ start: at, end: at + element.length, text: jsxChildContext(code, at) ? `{${call}}` : call });
    }
    const expr = new RegExp(`\\{\\s*([A-Za-z_$][\\w$.]*(?:\\[|\\()\\s*${escapeRe(cb.item)}\\??\\.${hit[1]}\\s*(?:\\]|\\)))\\s*\\}`, "g");
    for (const m of body.matchAll(expr)) {
      const at = cb.bodyStart + (m.index ?? 0);
      if (code[at - 1] === "=") continue;
      wraps.push({ start: at, end: at + m[0].length, text: `{tfIcon(${value}, ${m[1]}, "h-[1em] w-[1em]")}` });
    }
  }
  if (!wraps.length) return code;
  const out = applyWraps(code, wraps);
  if (out === code) return code;
  const defaults = new Set<string>();
  collectIconDefaults(content, defaults);
  void sectionType;
  let next = addHelper(out, SECTION_ICON([...defaults]), "function tfIcon");
  next = addImport(next, `import { eventsIconMap, renderEventsIcon } from "../../../lib/eventsIcons";\n`);
  next = addImport(next, `import { WebsiteIcon, preferredWebsiteIconName } from "../../../lib/websiteIcons";\n`);
  return ensureReactImport(next);
}

function ensureReactImport(code: string): string {
  if (/import\s+(\*\s+as\s+)?React\b/.test(code) || /import\s+React\s*,/.test(code)) return code;
  return addImport(code, `import type React from "react";\n`);
}

function applyWraps(code: string, wraps: Wrap[]): string {
  const accepted: Wrap[] = [];
  for (const wrap of wraps.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (accepted.some((w) => wrap.start < w.end && wrap.end > w.start)) continue;
    accepted.push(wrap);
  }
  let out = code;
  for (const wrap of accepted.sort((a, b) => b.start - a.start)) out = out.slice(0, wrap.start) + wrap.text + out.slice(wrap.end);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Social links

export function socialPlatformId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let id = raw.replace(/^(Fa|Si|Lu|Fi|Bs|Ri|Ai|Io|Tb)(?=[A-Z])/, "").replace(/(Icon|Fill|Line|Outline|Square|Circle|F)$/g, "");
  id = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (id === "twitterx" || id === "xtwitter") return "x";
  if (id === "mail" || id === "envelope") return "email";
  if (id === "globe" || id === "web") return "website";
  return id;
}

function templateSocialId(item: Record<string, unknown>): string {
  return socialPlatformId(item.platform ?? item.name ?? item.label ?? item.title ?? "");
}

/** Every socialLinks item gets an `icon` platform id the editor dropdown understands. */
export function normalizeSocialContent(content: Record<string, unknown>): Record<string, unknown> {
  const links = content.socialLinks;
  if (!Array.isArray(links)) return content;
  return {
    ...content,
    socialLinks: links.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const record = item as Record<string, unknown>;
      if (typeof record.icon === "string" && record.icon) return record;
      const id = templateSocialId(record);
      return id ? { ...record, icon: id } : record;
    }),
  };
}

const SOCIAL_ICON = `function tfSocialIcon(item: any, fallback: React.ReactNode, className: string): React.ReactNode {
  const id = String(item?.icon ?? "").trim().toLowerCase();
  const own = String(item?.platform ?? item?.name ?? item?.label ?? item?.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!isSocialPlatformId(id) || id === own) return fallback;
  const Icon = getSocialPlatformIcon(id);
  return <Icon className={className} />;
}

`;

/** Social link icons follow the editor's platform dropdown. */
export function wrapSocialIcons(code: string): string {
  if (code.includes("function tfSocialIcon")) return code;
  const wraps: Wrap[] = [];
  for (const cb of mapCallbacks(code)) {
    if (cb.collection !== "socialLinks") continue;
    const body = code.slice(cb.bodyStart, cb.bodyEnd);
    const locals = [...body.matchAll(/(?:const|let)\s+([A-Z][\w$]*)\s*=/g)].map((m) => m[1]!);
    const before = wraps.length;
    wrapElements(code, cb, cb.item, "tfSocialIcon", locals, wraps);
    if (wraps.length > before) continue;
    const element = new RegExp(`<([A-Z][\\w$.]*)\\b[^<>]*\\b${escapeRe(cb.item)}\\b[^<>]*/>|\\{\\s*[A-Za-z_$][\\w$.]*\\[\\s*${escapeRe(cb.item)}\\??\\.\\w+\\s*\\]\\s*\\}`, "g");
    for (const m of body.matchAll(element)) {
      const at = cb.bodyStart + (m.index ?? 0);
      if (code[at - 1] === "=") continue;
      const isExpr = m[0].startsWith("{");
      const inner = isExpr ? m[0].slice(1, -1).trim() : m[0];
      const call = `tfSocialIcon(${cb.item}, ${inner}, ${JSON.stringify((isExpr ? null : jsxClass(m[0])) ?? "h-4 w-4")})`;
      wraps.push({ start: at, end: at + m[0].length, text: isExpr || jsxChildContext(code, at) ? `{${call}}` : call });
    }
  }
  if (!wraps.length) return code;
  const out = applyWraps(code, wraps);
  let next = addHelper(out, SOCIAL_ICON, "function tfSocialIcon");
  next = addImport(next, `import { getSocialPlatformIcon, isSocialPlatformId } from "../../../lib/socialPlatforms";\n`);
  return ensureReactImport(next);
}
