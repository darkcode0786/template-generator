import path from "node:path";

/** Convert any path to forward slashes (used for globs, manifests and the UI). */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/").replace(/\\/g, "/");
}

/**
 * Returns true when `candidate` resolves to `root` or a descendant of it.
 * Case-insensitive on Windows.
 */
export function isInside(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  const rel = path.relative(r, c);
  if (rel === "") return true;
  if (rel.startsWith("..")) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

/**
 * Join a relative, untrusted segment onto a trusted root and refuse anything
 * that escapes it (`..`, absolute paths, drive letters, NUL bytes).
 */
export function safeJoin(root: string, relative: string): string {
  if (relative.includes("\0")) throw new Error(`Invalid path (NUL byte): ${relative}`);
  const normalizedRel = relative.replace(/\\/g, "/");
  if (normalizedRel.startsWith("/") || /^[A-Za-z]:/.test(normalizedRel)) {
    throw new Error(`Absolute paths are not allowed: ${relative}`);
  }
  const segments = normalizedRel.split("/").filter(Boolean);
  if (segments.some((s) => s === "..")) {
    throw new Error(`Path traversal is not allowed: ${relative}`);
  }
  const joined = path.resolve(root, ...segments);
  if (!isInside(root, joined)) {
    throw new Error(`Path escapes root: ${relative}`);
  }
  return joined;
}

/** True when a relative POSIX path is a well-formed, traversal-free target path. */
export function isSafeRelativePath(rel: string): boolean {
  if (!rel || rel.includes("\0")) return false;
  const norm = rel.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[A-Za-z]:/.test(norm)) return false;
  const segs = norm.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return false;
  // Windows reserved names / illegal chars
  if (segs.some((s) => /[<>:"|?*]/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s))) return false;
  return true;
}

/** Folder and file names safe for `themes/{key}/assets/...` (no spaces). */
export function sanitizeAssetTarget(target: string): string {
  const parts = target.replace(/\\/g, "/").split("/").filter(Boolean);
  const cleaned = parts.map((part, index) => {
    const ext = index === parts.length - 1 ? path.posix.extname(part).toLowerCase() : "";
    const stem = ext ? part.slice(0, part.length - ext.length) : part;
    const slug = stem
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${slug || "file"}${ext}`;
  });
  return cleaned.join("/");
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "untitled";
}

export function pascalCase(input: string): string {
  const words = input
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return /^[0-9]/.test(out) ? `T${out}` : out || "Theme";
}

export function titleCase(input: string): string {
  return input
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function timestampKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
