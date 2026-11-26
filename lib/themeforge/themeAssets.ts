/** Per-theme image helper shipped in the pack (`lib/<theme>Assets.ts`), same shape as the fixed upload packs. */

export function themeAssetModuleName(templateSlug: string): string {
  const parts = templateSlug.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const camel = parts.map((part, index) => (index === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())).join("");
  const base = /^[A-Za-z]/.test(camel) ? camel : `theme${camel}`;
  return `${base}Assets`;
}

export function themeAssetModuleSource(templateSlug: string, themeKey: string, moduleName = themeAssetModuleName(templateSlug)): string {
  const fn = moduleName.replace(/Assets$/, "") || "theme";
  const assetFn = `${fn}Asset`;
  const keyConst = `${fn.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_THEME_KEY`;
  const family = templateSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `const LOCAL_THEMES = process.env.NEXT_PUBLIC_THEME_ASSET_BASE || "http://localhost:4000/uploads/themes";
const ${keyConst} = ${JSON.stringify(themeKey)};

function themeKey(value: unknown) {
  return typeof value === "string" && /${family}/i.test(value) ? value.trim() : "";
}

function resolveThemeAssetKey() {
  if (typeof window !== "undefined") {
    const forced = (window as Window & { __LESTOW_THEME_ASSET_KEY__?: string }).__LESTOW_THEME_ASSET_KEY__;
    const fromForced = themeKey(forced);
    if (fromForced) return fromForced;
    const pathKey = window.location.pathname.match(/\\/theme\\/([^/?#]+)/i);
    const fromPath = themeKey(pathKey && pathKey[1] ? decodeURIComponent(pathKey[1]) : "");
    if (fromPath) return fromPath;
    try {
      const query = new URLSearchParams(window.location.search).get("templateId");
      const fromQuery = themeKey(query);
      if (fromQuery) return fromQuery;
    } catch {
      /* ignore */
    }
  }
  return ${keyConst};
}

export function ${assetFn}(path: string | undefined | null) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  const cleaned = raw.replace(/^\\.\\//, "").replace(/^\\/+/, "").replace(/^assets\\//i, "");
  const segments = cleaned.split("/").filter(Boolean).map((part) => encodeURIComponent(part));
  return LOCAL_THEMES + "/" + resolveThemeAssetKey() + "/assets/" + segments.join("/");
}

export const themeUploadAsset = ${assetFn};

export function mapThemeUploadAssetsInData<T>(data: T): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (/^(data:|blob:|#|mailto:|tel:)/i.test(value)) return value;
      if (/^https?:/i.test(value)) return /\\s|\\/themes\\//i.test(value) ? encodeURI(value) : value;
      if (/\\.(png|jpe?g|webp|gif|svg|avif|mp4|webm)(\\?|$)/i.test(value)) {
        const abs = value.match(/\\/themes\\/([^/]+)\\/assets\\/(.+)$/i);
        if (abs && /${family}/i.test(abs[1]) && typeof window !== "undefined") {
          (window as Window & { __LESTOW_THEME_ASSET_KEY__?: string }).__LESTOW_THEME_ASSET_KEY__ = abs[1];
        }
        return ${assetFn}(value);
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, next] of Object.entries(value as Record<string, unknown>)) out[key] = walk(next);
      return out;
    }
    return value;
  };
  return walk(data) as T;
}
`;
}
