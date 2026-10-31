import type { MappingPlan } from "./types";

const LABEL_ANCHOR: Record<string, string> = {
  home: "home",
  "about us": "about",
  about: "about",
  services: "services",
  service: "services",
  "our services": "services",
  "our service": "services",
  gallery: "gallery",
  "our gallery": "gallery",
  team: "team",
  teams: "team",
  "our team": "team",
  faq: "faq",
  faqs: "faq",
  "contact us": "contact",
  contact: "contact",
};

const CHROME = new Set(["Header", "Footer", "Topbar", "Breadcrumb", "NotFound"]);

const INDEX_NUMBER_SECTIONS = new Set(["FAQ", "Faqs", "Services", "OurService", "Service"]);

/** First three letters of the template name: wedding-planner-2 → Wed, petlimb → Pet. */
export function landingPrefix(templateSlug: string): string {
  const word = templateSlug.split(/[-_\s]/).find((part) => /[a-z]/i.test(part)) ?? "site";
  const letters = word.replace(/[^a-zA-Z]/g, "");
  const slice = (letters || "site").slice(0, 3);
  return slice.charAt(0).toUpperCase() + slice.slice(1).toLowerCase();
}

/** Gallery and Team are manager types. A landing block keeps the component key and takes a unique type. */
export function landingSectionType(sectionType: string, prefix: string): string {
  if (sectionType === "Gallery") return `${prefix}Gallery`;
  if (sectionType === "Team") return `${prefix}Team`;
  return sectionType;
}

export function isLandingSite(pages: { id: string; sections: string[] }[]): boolean {
  const filled = pages.filter((page) => page.sections.length > 0);
  return filled.length === 1 && filled[0].id === "home";
}

export function applyLandingPlan(plan: MappingPlan, templateSlug: string, force = false): boolean {
  if (force) collapseToHome(plan);
  if (!isLandingSite(plan.pages)) return false;
  const prefix = landingPrefix(templateSlug);
  const rename = (type: string) => landingSectionType(type, prefix);
  for (const component of plan.components) component.sectionType = rename(component.sectionType);
  for (const page of plan.pages) {
    page.sectionType = rename(page.sectionType);
    page.sections = page.sections.map(rename);
  }
  return true;
}

/** The landing spec keeps the home scroll and drops manager, detail, and not-found pages. */
function collapseToHome(plan: MappingPlan) {
  const filled = plan.pages.filter((page) => page.sections.length > 0);
  const home = filled.find((page) => page.id === "home") ?? filled[0];
  if (!home) return;
  const sections: string[] = [];
  const push = (section: string) => {
    if (!sections.includes(section)) sections.push(section);
  };
  for (const page of [home, ...filled.filter((page) => page !== home)]) {
    for (const section of page.sections) {
      if (section === "Breadcrumb" || section === "NotFound") continue;
      if (/Page$|Detail$/.test(section)) continue;
      if (page !== home && (section === "Header" || section === "Topbar" || section === "Footer")) continue;
      push(section);
    }
  }
  home.id = "home";
  home.label = home.label || "Home";
  home.sectionType = "Home";
  home.sections = [...sections.filter((section) => section !== "Footer"), ...(sections.includes("Footer") ? ["Footer"] : [])];
  plan.pages = [home];
}

/** Id on the section element. Header hashes scroll to these. */
export function landingAnchorFor(sectionType: string): string | null {
  if (CHROME.has(sectionType)) return null;
  const named: Record<string, string> = {
    Banner: "home",
    About: "about",
    Services: "services",
    OurService: "services",
    Service: "services",
    FAQ: "faq",
    Faqs: "faq",
    Contact: "contact",
    Testimonial: "testimonials",
    Testimonials: "testimonials",
  };
  if (named[sectionType]) return named[sectionType];
  if (/Gallery$/.test(sectionType)) return "gallery";
  if (/Team$/.test(sectionType)) return "team";
  return sectionType
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** A hash the design already uses (`#testimonials`) stays that hash. `#` splits must not turn it into home. */
function existingSectionHash(raw: string): string | null {
  if (!raw.startsWith("#") || raw.toLowerCase().startsWith("#page-")) return null;
  const id = raw.slice(1).split(/[/?]/)[0].toLowerCase();
  if (!id || id === "home") return "#home";
  return `#${id}`;
}

export function landingMenuHref(url: string | undefined, label: string | undefined, anchors: ReadonlySet<string>): string {
  const raw = String(url || "").trim();
  if (/^(mailto:|tel:|https?:)/i.test(raw)) return raw;
  const kept = existingSectionHash(raw);
  if (kept) return kept;
  const labeled = LABEL_ANCHOR[String(label || "").trim().toLowerCase()];
  if (labeled && (!anchors.size || anchors.has(labeled))) return `#${labeled}`;
  const slug = raw
    .replace(/^#page-/i, "")
    .replace(/^\//, "")
    .split(/[?#]/)[0]
    .replace(/\/$/, "")
    .toLowerCase();
  const fromSlug = LABEL_ANCHOR[slug] || (slug === "" || slug === "home" ? "home" : slug);
  if (fromSlug && (!anchors.size || anchors.has(fromSlug) || fromSlug === "home")) return `#${fromSlug}`;
  if (raw.startsWith("#")) return raw.replace(/^#page-/i, "#");
  return raw || "#home";
}

export function rewriteLandingLinks(value: unknown, anchors: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteLandingLinks(item, anchors));
  if (!value || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    next[key] = rewriteLandingLinks(child, anchors);
  }
  const label = typeof next.label === "string" ? next.label : typeof next.text === "string" ? next.text : "";
  for (const key of ["url", "href"] as const) {
    if (typeof next[key] === "string") next[key] = landingMenuHref(String(next[key]), label, anchors);
  }
  return next;
}

export function ensureSectionAnchor(code: string, sectionType: string): string {
  const id = landingAnchorFor(sectionType);
  if (!id) return code;
  const match = /<(section|header|footer)\b([^>]*)>/.exec(code);
  if (!match || match.index === undefined) return code;
  const attrs = match[2] ?? "";
  if (/\bid\s*=/.test(attrs)) {
    const current = /\bid=(?:\{)?["']([^"']+)["']/.exec(attrs);
    if (current?.[1] === id || (current && !current[1].startsWith("page-"))) return code;
    const replaced = match[0].replace(/\bid=(?:\{)?["'][^"']+["']\}?/, `id="${id}"`);
    return code.slice(0, match.index) + replaced + code.slice(match.index + match[0].length);
  }
  const tag = match[0].replace(/>$/, ` id="${id}">`);
  return code.slice(0, match.index) + tag + code.slice(match.index + match[0].length);
}

const LANDING_HIDDEN = new Set([
  "openMenuLabel",
  "closeMenuLabel",
  "taglineIcon",
  "socialTitle",
  "copyrightText",
  "copyright",
  "favoritesUrl",
  "favoritesLabel",
  "favoritesIcon",
  "phoneIcon",
]);

export function landingHiddenFields(fields: readonly string[]): Set<string> {
  const hidden = new Set<string>();
  const showsLogo = fields.some((field) => field === "logo" || field === "logoImage");
  for (const field of fields) {
    if (LANDING_HIDDEN.has(field)) hidden.add(field);
    if (showsLogo && (field === "brandName" || field === "brandTagline")) hidden.add(field);
  }
  return hidden;
}

export function renderIndexNumbers(code: string, sectionType: string): string {
  if (!INDEX_NUMBER_SECTIONS.has(sectionType)) return code;
  let out = code;
  for (const match of code.matchAll(/\.map\(\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g)) {
    const item = match[1];
    const index = match[2];
    const expr = `{String(${index} + 1).padStart(2, "0")}`;
    out = out.replace(new RegExp(`\\{${item}\\??\\.number(?:\\s*\\|\\|\\s*[^}]+)?\\}`, "g"), expr);
  }
  return out;
}

export function stripStoredNumbers(value: unknown, sectionType: string): unknown {
  if (!INDEX_NUMBER_SECTIONS.has(sectionType)) return value;
  if (Array.isArray(value)) return value.map((item) => stripStoredNumbers(item, sectionType));
  if (!value || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "number") continue;
    next[key] = stripStoredNumbers(child, sectionType);
  }
  return next;
}

export function scopeCardHover(code: string): string {
  return code
    .replace(/\bgroup-hover:/g, "group-hover/item:")
    .replace(/(^|[\s"'`])group(?![\w/-])/g, "$1group/item");
}

export function inlineReveal(code: string): string {
  if (!/\bReveal\b/.test(code)) return code;
  let out = code.replace(/^\s*import\s+Reveal\s+from\s+['"][^'"]+['"]\s*;?\s*\n/m, "");
  out = out.replace(/^\s*import\s*\{([^}]*)\}\s*from\s+(['"][^'"]+['"])\s*;?\s*\n/gm, (full, names: string, from: string) => {
    if (!/\bReveal\b/.test(names)) return full;
    const kept = names
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name && !/^Reveal\b/.test(name));
    if (!kept.length) return "";
    return `import { ${kept.join(", ")} } from ${from};\n`;
  });
  if (/\bfunction Reveal\b/.test(out) || !/\b<Reveal\b/.test(out)) return out;
  const fn = `function Reveal({ children, className }: { children?: React.ReactNode; className?: string }) {\n  return <div className={className}>{children}</div>;\n}\n\n`;
  if (/^['"]use client['"];\s*\n/.test(out)) return out.replace(/^(['"]use client['"];\s*\n)/, `$1${fn}`);
  return fn + out;
}

export function guardEmptyImage(code: string): string {
  if (!/from\s+['"]next\/image['"]/.test(code)) return code;
  const out = code.replace(/^\s*import\s+Image\s+from\s+['"]next\/image['"]\s*;?\s*\n/m, "");
  if (/\bfunction Image\b/.test(out)) return out;
  const fn = `function Image({ src, alt, className }: { src?: string | null; alt?: string; className?: string }) {\n  if (!src) return null;\n  return <img src={src} alt={alt || ""} className={className} />;\n}\n\n`;
  if (/^['"]use client['"];\s*\n/.test(out)) return out.replace(/^(['"]use client['"];\s*\n)/, `$1${fn}`);
  return fn + out;
}

export function landingFontBoot(fontValue: string): string {
  const family = fontValue.split(",")[0]?.replace(/['"]/g, "").trim() || "Poppins";
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
  const css = `[data-site-theme-root],[data-site-theme-root] :where(h1,h2,h3,h4,h5,h6){font-family:"${family}",var(--font-body),sans-serif}`;
  return `  if (typeof document !== "undefined" && !document.getElementById("theme-landing-font")) { const link = document.createElement("link"); link.id = "theme-landing-font"; link.rel = "stylesheet"; link.href = ${JSON.stringify(href)}; document.head.appendChild(link); const style = document.createElement("style"); style.id = "theme-landing-font-style"; style.textContent = ${JSON.stringify(css)}; document.head.appendChild(style); }`;
}

export function rewriteLandingLiteralHrefs(code: string, anchors: ReadonlySet<string>): string {
  return code.replace(/href=\{toLestowHref\(\s*(['"])([^'"]+)\1\s*\)\}/g, (_full, _quote: string, path: string) => {
    return `href="${landingMenuHref(path, "", anchors)}"`;
  });
}

/**
 * `toLestowHref("#testimonials")` becomes `#page-home`, so every header link
 * lands on home. Landing links keep the hash the menu already has.
 */
export function rewriteLandingDynamicHrefs(code: string): string {
  if (!/\btoLestowHref\s*\(/.test(code) || /\bfunction landingSectionHref\b/.test(code)) return code;
  const helper = `function landingSectionHref(url) {\n  const raw = String(url ?? "").trim();\n  if (!raw || raw === "#") return "#home";\n  if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;\n  if (raw.startsWith("#")) return raw.toLowerCase().startsWith("#page-") ? "#" + raw.slice(6) : raw;\n  const mapped = toLestowHref(raw);\n  return typeof mapped === "string" && mapped.startsWith("#page-") ? "#" + mapped.slice(6) : mapped;\n}\n\n`;
  const out = code.replace(/\btoLestowHref\s*\(/g, "landingSectionHref(");
  if (/^['"]use client['"];\s*\n/.test(out)) return out.replace(/^(['"]use client['"];\s*\n)/, `$1${helper}`);
  return helper + out;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Accent and page background follow Theme Color. Heading and body text stay the design colour. */
export function pinLandingColors(variables: Record<string, string>): Record<string, string> {
  const next = { ...variables };
  next["--color-primary"] = "var(--primary-bg)";
  next["--color-brand"] = "var(--primary-bg)";
  next["--color-accent"] = "var(--blue-bg)";
  next["--color-bg-main"] = "var(--secondary-bg)";
  const heading = HEX.test(next["--header-text"] || "")
    ? next["--header-text"]
    : HEX.test(next["--secondary-text"] || "")
      ? next["--secondary-text"]
      : "#1a1a1a";
  const text = HEX.test(next["--secondary-text"] || "") ? next["--secondary-text"] : heading;
  next["--color-heading"] = heading;
  next["--header-text"] = heading;
  next["--color-text"] = text;
  if (!HEX.test(next["--color-text-light"] || "")) next["--color-text-light"] = "#5c6560";
  return next;
}
