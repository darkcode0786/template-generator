/**
 * Minimal dependency-free glob matcher for POSIX-style relative paths.
 * Supports `**`, `*`, `?` and `{a,b}` alternation. Matching is case-insensitive
 * on file extensions because Windows filesystems are.
 */
const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached) return cached;

  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more directories; bare `**` matches anything
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
        i += 1;
      } else {
        const alts = glob
          .slice(i + 1, end)
          .split(",")
          .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        re += `(?:${alts.join("|")})`;
        i = end + 1;
      }
    } else if (/[.+^$()|[\]\\]/.test(c)) {
      re += `\\${c}`;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  const compiled = new RegExp(`^${re}$`, "i");
  cache.set(glob, compiled);
  return compiled;
}

export function matchesGlob(relPath: string, glob: string): boolean {
  return globToRegExp(glob).test(relPath.replace(/\\/g, "/"));
}

export function matchesAny(relPath: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchesGlob(relPath, g));
}
