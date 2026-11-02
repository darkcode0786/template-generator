/**
 * Extract CSS custom properties from a stylesheet so they can be inlined into
 * every generated component the way the reference theme does
 * (`<style id="theme-upload-css-vars">:root{--color-primary:#…}</style>`).
 *
 * Handles plain `:root { … }` / `html { … }` blocks and Tailwind v4 `@theme { … }` blocks.
 * Only `--name: value;` declarations are kept; nested blocks and non-custom properties are ignored.
 */

const SELECTOR_RE = /(?:^|[\s}])(:root|html|@theme(?:\s+\w+)?)\s*\{/g;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Return the body of the block starting at `openBraceIdx` (exclusive of braces). */
function blockBody(css: string, openBraceIdx: number): string | null {
  let depth = 0;
  for (let i = openBraceIdx; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return css.slice(openBraceIdx + 1, i);
    }
  }
  return null;
}

export function extractCssVariables(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = stripComments(css);
  SELECTOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SELECTOR_RE.exec(clean))) {
    const open = m.index + m[0].length - 1;
    const body = blockBody(clean, open);
    if (body === null) continue;
    // Drop nested blocks (e.g. media queries inside @theme) before reading declarations.
    const flat = body.replace(/[^{};]*\{[^{}]*\}/g, "");
    for (const decl of flat.split(";")) {
      const idx = decl.indexOf(":");
      if (idx < 0) continue;
      const name = decl.slice(0, idx).trim();
      const value = decl.slice(idx + 1).trim().replace(/\s+/g, " ");
      if (!/^--[\w-]+$/.test(name) || !value) continue;
      if (!(name in out)) out[name] = value; // first definition wins, like the cascade's :root order
    }
  }
  return out;
}

/** Merge variables from several stylesheets; earlier files take precedence. */
export function mergeCssVariables(sheets: string[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const css of sheets) {
    for (const [k, v] of Object.entries(extractCssVariables(css))) if (!(k in merged)) merged[k] = v;
  }
  return merged;
}

/** `:root{--a:b;--c:d;}` – compact, safe to embed in a JS string literal via JSON.stringify. */
export function serializeRootVars(vars: Record<string, string>): string {
  const decls = Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  return `:root{${decls}}`;
}

/** Readable multi-line stylesheet for `styles/variables.css`. */
export function formatRootVarsCss(vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  return `/* Theme variables collected from the source repository's global stylesheets.\n   The same set is injected at runtime by every component (#theme-upload-css-vars). */\n:root {\n${lines.join("\n")}\n}\n`;
}

/**
 * Keys the host Theme Color panel reads from `theme.json` `variables`.
 * Values are the theme's own defaults; the panel writes these same names.
 */
export const THEME_VARIABLE_KEYS = [
  "--primary-bg",
  "--primary-text",
  "--secondary-bg",
  "--secondary-text",
  "--header-bg",
  "--header-text",
  "--hero-bg",
  "--hero-title",
  "--blue-bg",
  "--primary-link-bg",
  "--primary-link-color",
  "--secondary-link-bg",
  "--font-heading",
  "--font-body",
  "--font-button",
] as const;

const FALLBACK_FONT = "Poppins, system-ui, sans-serif";
const FALLBACK_PRIMARY = "#2563eb";
const FALLBACK_INK = "#0f172a";
const FALLBACK_PAPER = "#ffffff";

interface Rgb {
  hex: string;
  s: number;
  l: number;
}

function parseColor(input: string): Rgb | null {
  const v = input.trim().toLowerCase();
  let r = 0;
  let g = 0;
  let b = 0;
  const hex = v.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 8) h = h.slice(0, 6);
    if (h.length === 4) h = h.slice(0, 3);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6) return null;
    r = Number.parseInt(h.slice(0, 2), 16);
    g = Number.parseInt(h.slice(2, 4), 16);
    b = Number.parseInt(h.slice(4, 6), 16);
  } else {
    const rgb = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if (!rgb) return null;
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  }
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const out = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  return { hex: out, s, l };
}

function lookupColor(source: Record<string, string>, names: string[]): string | null {
  const map = new Map(Object.entries(source).map(([k, v]) => [k.toLowerCase(), v]));
  for (const name of names) {
    const raw = map.get(name.toLowerCase());
    if (!raw) continue;
    const color = parseColor(raw);
    if (color) return color.hex;
  }
  return null;
}

function isBrand(hex: string): boolean {
  const c = parseColor(hex);
  return Boolean(c && c.s >= 0.15 && c.l >= 0.22 && c.l <= 0.82);
}

function isDark(hex: string): boolean {
  const c = parseColor(hex);
  return Boolean(c && c.l < 0.24);
}

function contrastingText(bg: string): string {
  const c = parseColor(bg);
  return c && c.l < 0.72 ? "#ffffff" : FALLBACK_INK;
}

function fontStack(raw: string | undefined): string | null {
  if (!raw) return null;
  const parts = raw.replace(/['"]/g, "").split(",").map((p) => p.trim()).filter(Boolean);
  const generic = parts.filter((p) => /^(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif)$/i.test(p));
  const named = parts.filter((p) => !/^var\(/i.test(p) && !generic.includes(p));
  if (named.length) {
    const tail = generic.length ? generic : /serif/i.test(named.join(" ")) ? ["Georgia", "serif"] : ["system-ui", "sans-serif"];
    return [...named, ...tail].join(", ");
  }
  const varName = raw.match(/var\(\s*(--[\w-]+)/i)?.[1]?.replace(/^--font-/i, "").replace(/-/g, " ").trim() ?? "";
  if (!varName || /^(sans|serif|mono|body|heading|primary|ui|button|base|text)$/i.test(varName)) return null;
  const label = varName.replace(/\b\w/g, (c) => c.toUpperCase());
  return /serif/i.test(varName) ? `${label}, Georgia, serif` : `${label}, system-ui, sans-serif`;
}

function pickFont(source: Record<string, string>, names: string[], fallback: string): string {
  const map = new Map(Object.entries(source).map(([k, v]) => [k.toLowerCase(), v]));
  for (const name of names) {
    const stack = fontStack(map.get(name.toLowerCase()));
    if (stack) return stack;
  }
  return fallback;
}

export interface ThemeVariableBuild {
  /** Exact Theme Color keys, in panel order. */
  variables: Record<string, string>;
  /** What each component injects: panel keys, aliases the host follows, then any other source vars. */
  injected: Record<string, string>;
  /** Brand / accent / hero hexes rewritten to host color aliases. */
  rewrites: { hex: string; variable: string }[];
  /** Source custom properties rewritten onto those same aliases. */
  varRewrites: { from: string; to: string }[];
}

/**
 * Map a repository's colours onto the Theme Color keys.
 * A saturated accent (Lexora gold, ElectroCare green) becomes Primary.
 * A dark navy sitting in `--color-primary` becomes the hero band when a lighter brand colour exists.
 */
export function buildThemeVariables(source: Record<string, string>, componentSource = ""): ThemeVariableBuild {
  const counts = new Map<string, number>();
  for (const m of componentSource.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const color = parseColor(`#${m[1]}`);
    if (!color || color.s < 0.12) continue;
    counts.set(color.hex, (counts.get(color.hex) ?? 0) + 1);
  }
  // Tailwind @theme names (`bg-maroon`, `text-gold`) count as uses of that colour.
  for (const [key, value] of Object.entries(source)) {
    const name = /^--color-([\w-]+)$/.exec(key)?.[1];
    const color = name ? parseColor(value) : null;
    if (!name || !color || color.s < 0.12) continue;
    const uses = componentSource.match(new RegExp(`-${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g"))?.length ?? 0;
    if (uses) counts.set(color.hex, (counts.get(color.hex) ?? 0) + uses);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const mid = ranked.filter(isBrand);
  const dark = ranked.filter((hex) => isDark(hex) && (parseColor(hex)?.s ?? 0) >= 0.12);

  const namedBrand = lookupColor(source, ["--color-brand", "--brand", "--brand-color"]);
  const namedMain = lookupColor(source, ["--color-primary", "--primary", "--color-main", "--primary-color"]);
  const namedAccent = lookupColor(source, ["--color-accent", "--accent", "--accent-color"]);
  const explicitPrimary = lookupColor(source, ["--primary-bg"]);

  let primary = explicitPrimary || (namedBrand && isBrand(namedBrand) ? namedBrand : null) || (namedMain && isBrand(namedMain) ? namedMain : null) || (namedAccent && isBrand(namedAccent) ? namedAccent : null) || namedMain || mid[0] || ranked[0] || FALLBACK_PRIMARY;

  const explicitBlue = lookupColor(source, ["--blue-bg"]);
  const blue = explicitBlue || (namedAccent && namedAccent !== primary ? namedAccent : null) || mid.find((hex) => hex !== primary) || primary;

  const explicitHero = lookupColor(source, ["--hero-bg", "--color-navy", "--color-dark", "--color-primary-dark"]);
  const hero = explicitHero || (namedMain && namedMain !== primary && isDark(namedMain) ? namedMain : null) || dark.find((hex) => hex !== primary) || FALLBACK_INK;

  const paper = lookupColor(source, ["--secondary-bg", "--color-bg-main", "--color-background", "--background", "--color-bg", "--color-bg-light", "--color-page", "--color-surface"]) || FALLBACK_PAPER;
  const ink = lookupColor(source, ["--secondary-text", "--color-text", "--color-foreground", "--foreground", "--color-heading", "--color-ink"]) || (hero !== primary ? hero : FALLBACK_INK);
  const headerBg = lookupColor(source, ["--header-bg"]) || FALLBACK_PAPER;
  const headerText = lookupColor(source, ["--header-text"]) || (isDark(hero) ? hero : ink);
  const primaryText = lookupColor(source, ["--primary-text"]) || contrastingText(primary);
  const heroTitle = lookupColor(source, ["--hero-title"]) || contrastingText(hero);
  const linkBg = lookupColor(source, ["--primary-link-bg"]) || primary;
  const linkText = lookupColor(source, ["--primary-link-color"]) || contrastingText(linkBg);
  const secondaryLink = lookupColor(source, ["--secondary-link-bg"]) || hero;

  const bodyFont = pickFont(source, ["--font-body", "--font-sans", "--font-base", "--font-primary", "--font-text"], FALLBACK_FONT);
  const headingFont = pickFont(source, ["--font-heading", "--font-display", "--font-serif"], bodyFont);
  const buttonFont = pickFont(source, ["--font-button", "--font-ui"], bodyFont);

  const variables: Record<string, string> = {
    "--primary-bg": primary,
    "--primary-text": primaryText,
    "--secondary-bg": paper,
    "--secondary-text": ink,
    "--header-bg": headerBg,
    "--header-text": headerText,
    "--hero-bg": hero,
    "--hero-title": heroTitle,
    "--blue-bg": blue,
    "--primary-link-bg": linkBg,
    "--primary-link-color": linkText,
    "--secondary-link-bg": secondaryLink,
    "--font-heading": headingFont,
    "--font-body": bodyFont,
    "--font-button": buttonFont,
  };

  const injected: Record<string, string> = { ...variables };
  injected["--color-brand"] = "var(--primary-bg)";
  injected["--color-primary"] = "var(--primary-bg)";
  injected["--color-accent"] = "var(--blue-bg)";
  for (const [key, value] of Object.entries(source)) {
    if (!(key in injected)) injected[key] = value;
  }

  const rewrites: { hex: string; variable: string }[] = [];
  const addRewrite = (hex: string, variable: string) => {
    const color = parseColor(hex);
    if (!color || rewrites.some((r) => r.hex === color.hex)) return;
    rewrites.push({ hex: color.hex, variable });
  };
  // Host theme root maps these names. A fixed hex, or a name it does not know, does not follow Theme Color.
  addRewrite(primary, "--color-primary");
  if (blue !== primary) addRewrite(blue, "--color-accent");
  const paperColor = parseColor(paper);
  if (paperColor) addRewrite(paper, paperColor.l >= 0.94 ? "--color-white" : "--color-surface-blue");
  addRewrite(ink, "--color-heading");
  if (hero !== ink && hero !== primary) addRewrite(hero, "--color-heading");

  const aliasFor = (hex: string): string | undefined => rewrites.find((r) => r.hex === parseColor(hex)?.hex)?.variable;
  const kept = new Set([
    "--color-primary", "--color-brand", "--color-accent", "--color-heading", "--color-slate-900", "--color-slate-800",
    "--color-slate-500", "--color-gray-500", "--color-bg-alt", "--color-surface-blue", "--color-slate-50", "--color-white",
    "--color-blue-300", "--color-blue-400", "--color-blue-500", "--color-blue-600", "--color-blue-700",
    "--color-navy-overlay", "--color-footer-overlay", "--color-achievements-overlay", "--color-breadcrumb-overlay", "--color-breadcrumb-overlay-rgba",
    "--primary-bg", "--primary-text", "--secondary-bg", "--secondary-text", "--header-bg", "--header-text", "--hero-bg", "--hero-title", "--blue-bg",
  ]);
  const varRewrites: { from: string; to: string }[] = [];
  for (const [name, value] of Object.entries(source)) {
    const to = aliasFor(value);
    if (!to || name === to || kept.has(name)) continue;
    varRewrites.push({ from: name, to });
  }

  // The editor paints theme.json variables on the preview root. The 15 panel
  // keys stay first. Every other token from the repo's global CSS is kept,
  // and a token that matches a panel colour points at that panel so Theme Color still drives it.
  const panelKeys = new Set<string>(THEME_VARIABLE_KEYS);
  for (const [key, value] of Object.entries(source)) {
    if (panelKeys.has(key)) continue;
    // Hero also aliases `--color-heading` in code, but a named hero token keeps its own shade here.
    const rewritten = varRewrites.find((item) => item.from === key && (item.to !== "--color-heading" || parseColor(value)?.hex === parseColor(ink)?.hex));
    variables[key] = rewritten ? `var(${rewritten.to})` : value;
  }
  variables["--color-primary"] = "var(--primary-bg)";
  variables["--color-brand"] = "var(--primary-bg)";
  variables["--color-accent"] = "var(--blue-bg)";

  return { variables, injected, rewrites, varRewrites };
}

/** `bg-primary` / `text-brand` paint nothing: the host Tailwind config has no such colors. */
export function rewriteUtilityColors(code: string): string {
  return code
    .replace(/\b(bg|text|border|fill|stroke|from|to|via|ring)-primary\b/g, "$1-[var(--color-primary)]")
    .replace(/\b(bg|text|border|fill|stroke|from|to|via|ring)-brand\b/g, "$1-[var(--color-brand)]")
    .replace(/\b(bg|text|border|fill|stroke)-accent\b/g, "$1-[var(--color-accent)]");
}

/** `var(--color-gold)` becomes the host alias that Theme Color actually sets. */
export function rewriteColorVars(code: string, names: { from: string; to: string }[]): string {
  let out = code;
  for (const { from, to } of [...names].sort((a, b) => b.from.length - a.from.length)) {
    out = out.replace(new RegExp(`var\\(\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`, "g"), `var(${to})`);
  }
  return out;
}

/** Replace a theme's brand hexes so Theme Color can restyle them. `bg-[#1B8A3E]` becomes `bg-[var(--color-primary)]`. */
export function rewriteThemeHexes(code: string, rewrites: { hex: string; variable: string }[]): string {
  let out = code;
  for (const { hex, variable } of rewrites) {
    const body = hex.replace(/^#/, "");
    out = out.replace(new RegExp(`#${body}(?![0-9a-fA-F])`, "gi"), `var(${variable})`);
  }
  return out;
}

/** The exact self-injecting IIFE the reference components carry at the top of their body. */
export function cssVarsInjector(vars: Record<string, string>, styleId = "theme-upload-css-vars"): string {
  const css = JSON.stringify(serializeRootVars(vars));
  const id = JSON.stringify(styleId);
  return `(() => { if (typeof document === "undefined") return; if (document.getElementById(${id})) return; const s = document.createElement("style"); s.id = ${id}; s.textContent = ${css}; document.head.appendChild(s); })();`;
}
