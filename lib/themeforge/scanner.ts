import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";
import { matchesAny } from "./glob";
import { isInside } from "./paths";
import type { ThemeSpec } from "./spec";
import type { ExcludedFile, FileCategory, ProjectInfo, ScanResult, ScannedFile } from "./types";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".jfif", ".bmp", ".ico"]);
const FONT_EXT = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);
const STYLE_EXT = new Set([".css", ".scss", ".sass", ".less"]);
const MEDIA_EXT = new Set([".mp4", ".webm", ".mp3", ".ogg", ".wav"]);
const DATA_EXT = new Set([".json", ".yaml", ".yml", ".md", ".mdx"]);
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro"]);
const CONFIG_BASENAMES = new Set([
  "package.json", "tsconfig.json", "jsconfig.json", "next.config.js", "next.config.mjs", "next.config.ts",
  "tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs", "postcss.config.js", "postcss.config.mjs",
  "vite.config.ts", "vite.config.js", "astro.config.mjs", "svelte.config.js", "nuxt.config.ts", ".eslintrc.json",
  "eslint.config.mjs", "eslint.config.js", "components.json", "vercel.json", "netlify.toml", ".gitignore",
  ".prettierrc", "babel.config.js", "webpack.config.js",
]);
const SECRET_SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".env", ".txt", ".md", ".yaml", ".yml", ".toml", ".css"]);
const SECRET_SCAN_MAX_BYTES = 512 * 1024;

function classify(rel: string, ext: string, spec: ThemeSpec): FileCategory {
  const base = path.posix.basename(rel);
  const lower = rel.toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === ".svg") return "icon";
  if (FONT_EXT.has(ext)) return "font";
  if (STYLE_EXT.has(ext)) return "style";
  if (MEDIA_EXT.has(ext)) return "media";
  if (CONFIG_BASENAMES.has(base) || base.startsWith(".")) return "config";
  if (ext === ".d.ts" || /\.d\.ts$/.test(base) || /(^|\/)types?\//.test(lower)) return "type";
  if (CODE_EXT.has(ext)) {
    const stem = base.replace(/\.[^.]+$/, "");
    const inPageDir = spec.sources.pageDirs.some((d) => rel === d || rel.startsWith(`${d}/`));
    if (inPageDir) {
      if (/^(page|index)$/.test(stem)) return "page";
      if (/^(layout|template|loading|error|not-found|_app|_document)$/.test(stem)) return "layout";
    }
    const inComponentDir = spec.sources.componentDirs.some((d) => rel.startsWith(`${d}/`));
    if (inComponentDir && (ext === ".tsx" || ext === ".jsx" || ext === ".vue" || ext === ".svelte")) return "component";
    if (ext === ".tsx" || ext === ".jsx") return "component";
    return "script";
  }
  if (DATA_EXT.has(ext)) return ext === ".md" || ext === ".mdx" ? "doc" : "data";
  if (ext === ".txt") return "doc";
  return "other";
}

function matchesSecretPattern(content: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    if (re.test(content)) return re.source;
  }
  return null;
}

export interface WalkOptions {
  maxFiles?: number;
  maxBytes?: number;
}

/**
 * Walk the cloned repository safely: no symlinks are followed, excluded
 * directories are pruned, secrets/dependencies/build output are reported as
 * excluded, and hard size limits abort the job.
 */
export async function scanRepository(repoDir: string, spec: ThemeSpec, opts: WalkOptions = {}): Promise<ScanResult> {
  const cfg = getConfig();
  const maxFiles = opts.maxFiles ?? cfg.maxFiles;
  const maxBytes = opts.maxBytes ?? cfg.maxRepoBytes;
  const root = path.resolve(repoDir);
  const realRoot = await fs.realpath(root);

  const files: ScannedFile[] = [];
  const excluded: ExcludedFile[] = [];
  const warnings: string[] = [];
  const secretPatterns = spec.exclude.secretContentPatterns.map((p) => new RegExp(p));
  const excludedDirs = new Set(spec.exclude.directories.map((d) => d.toLowerCase()));
  let totalBytes = 0;
  let seen = 0;

  async function walk(dirAbs: string, relDir: string): Promise<void> {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dirAbs, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isSymbolicLink()) {
        excluded.push({ path: rel, reason: "symlink (not followed)" });
        continue;
      }
      if (entry.isDirectory()) {
        if (excludedDirs.has(entry.name.toLowerCase())) {
          excluded.push({ path: `${rel}/`, reason: `excluded directory (${entry.name})` });
          continue;
        }
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;

      seen += 1;
      if (seen > maxFiles) {
        throw new Error(`Repository has more than ${maxFiles} files; aborting (raise THEMEFORGE_MAX_FILES to allow).`);
      }

      const stat = await fs.lstat(abs);
      if (!stat.isFile()) continue;
      // Defence against junctions/reparse points on Windows
      const real = await fs.realpath(abs).catch(() => abs);
      if (!isInside(realRoot, real)) {
        excluded.push({ path: rel, reason: "resolves outside repository" });
        continue;
      }

      totalBytes += stat.size;
      if (totalBytes > maxBytes) {
        throw new Error(`Repository exceeds ${Math.round(maxBytes / 1024 / 1024)} MB; aborting (raise THEMEFORGE_MAX_REPO_MB to allow).`);
      }

      if (matchesAny(rel, spec.exclude.files)) {
        excluded.push({ path: rel, reason: "matches exclusion pattern (secrets, lockfiles, archives, binaries)" });
        continue;
      }
      if (matchesAny(rel, spec.exclude.boilerplateAssets)) {
        excluded.push({ path: rel, reason: "framework boilerplate asset" });
        continue;
      }

      const ext = path.posix.extname(rel).toLowerCase();
      if (stat.size > spec.validation.maxFileSizeMB * 1024 * 1024) {
        excluded.push({ path: rel, reason: `larger than ${spec.validation.maxFileSizeMB} MB` });
        continue;
      }

      if (secretPatterns.length && SECRET_SCAN_EXT.has(ext) && stat.size <= SECRET_SCAN_MAX_BYTES) {
        const content = await fs.readFile(abs, "utf8").catch(() => "");
        const hit = matchesSecretPattern(content, secretPatterns);
        if (hit) {
          excluded.push({ path: rel, reason: `content matches secret pattern (${hit})` });
          continue;
        }
      }

      files.push({ path: rel, size: stat.size, ext, category: classify(rel, ext, spec) });
    }
  }

  await walk(root, "");

  const project = await detectProject(root, files, spec);
  project.totalFiles = files.length;
  project.totalBytes = files.reduce((a, f) => a + f.size, 0);
  if (project.framework === "unknown") {
    warnings.push("Could not detect a known framework; using generic mapping rules.");
  }
  return { files, excluded, project, warnings };
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function detectProject(root: string, files: ScannedFile[], spec: ThemeSpec): Promise<ProjectInfo> {
  const pkg = await readJson(path.join(root, "package.json"));
  const deps: Record<string, string> = {
    ...((pkg?.dependencies as Record<string, string>) || {}),
    ...((pkg?.devDependencies as Record<string, string>) || {}),
  };
  const has = (rel: string) => files.some((f) => f.path === rel);
  const hasDir = (dir: string) => files.some((f) => f.path.startsWith(`${dir}/`));

  let framework = "unknown";
  let frameworkVersion: string | undefined;
  const pick = (name: string, label: string) => {
    if (deps[name] && framework === "unknown") {
      framework = label;
      frameworkVersion = deps[name];
    }
  };
  pick("next", "Next.js");
  pick("nuxt", "Nuxt");
  pick("@remix-run/react", "Remix");
  pick("gatsby", "Gatsby");
  pick("astro", "Astro");
  pick("@sveltejs/kit", "SvelteKit");
  pick("svelte", "Svelte");
  pick("vue", "Vue");
  pick("@angular/core", "Angular");
  pick("vite", "Vite");
  pick("react", "React");
  if (framework === "unknown" && files.some((f) => f.ext === ".html")) framework = "Static HTML";

  const languages = new Set<string>();
  for (const f of files) {
    if (f.ext === ".ts" || f.ext === ".tsx") languages.add("TypeScript");
    else if (f.ext === ".js" || f.ext === ".jsx" || f.ext === ".mjs" || f.ext === ".cjs") languages.add("JavaScript");
    else if (f.ext === ".vue") languages.add("Vue SFC");
    else if (f.ext === ".svelte") languages.add("Svelte");
    else if (f.ext === ".html") languages.add("HTML");
    else if (f.ext === ".css") languages.add("CSS");
    else if (f.ext === ".scss" || f.ext === ".sass") languages.add("SCSS");
  }

  const styling: string[] = [];
  if (deps.tailwindcss) styling.push(`Tailwind CSS ${deps.tailwindcss}`);
  if (deps["styled-components"]) styling.push("styled-components");
  if (deps["@emotion/react"]) styling.push("Emotion");
  if (deps.sass) styling.push("Sass");
  if (deps.bootstrap) styling.push("Bootstrap");
  if (files.some((f) => /\.module\.(css|scss)$/.test(f.path))) styling.push("CSS Modules");
  if (deps["react-icons"]) styling.push("react-icons");
  if (deps["framer-motion"]) styling.push("framer-motion");

  let packageManager: string | undefined;
  const lock = (n: string) => files.some((f) => f.path === n) || has(n);
  if (typeof pkg?.packageManager === "string") packageManager = pkg.packageManager;
  else if (lock("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (lock("yarn.lock")) packageManager = "yarn";
  else if (lock("bun.lockb")) packageManager = "bun";
  else if (pkg) packageManager = "npm";

  const sourceRoots = [...spec.sources.componentDirs, ...spec.sources.pageDirs, ...spec.sources.dataDirs, "public", "styles", "lib", "types", "hooks", "utils"]
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .filter((d) => hasDir(d));

  const counts = Object.fromEntries(
    ["component", "page", "layout", "style", "image", "icon", "font", "data", "config", "script", "type", "doc", "media", "other"].map((c) => [c, 0]),
  ) as Record<FileCategory, number>;
  for (const f of files) counts[f.category] += 1;

  return {
    framework,
    frameworkVersion,
    languages: [...languages].sort(),
    styling,
    packageManager,
    packageName: typeof pkg?.name === "string" ? pkg.name : undefined,
    sourceRoots,
    hasAppRouter: hasDir("app") || hasDir("src/app"),
    hasPagesRouter: hasDir("pages") || hasDir("src/pages"),
    dependencies: deps,
    counts,
    totalFiles: files.length,
    totalBytes: 0,
  };
}
