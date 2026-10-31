import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getConfig } from "./config";

export const mappingKinds = ["component", "image", "icon", "font", "style", "data", "other"] as const;
export type MappingKind = (typeof mappingKinds)[number];

const mappingRuleSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(mappingKinds),
  description: z.string().optional(),
  /** Globs relative to the repository root. First matching rule wins. */
  match: z.array(z.string().min(1)).min(1),
  /** Globs that opt files out of this rule. */
  ignore: z.array(z.string()).default([]),
  /** Prefix removed from the source path before `{relativeDir}` is computed. */
  stripPrefix: z.array(z.string()).default([]),
  /**
   * Target template. Placeholders: {relativeDir} {basename} {stem} {ext}
   * {ComponentName} (component rules only).
   */
  target: z.string().min(1),
});

export const themeSpecSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive().default(1),
  description: z.string().optional(),
  /** One scrolling page: section hashes, no manager pages, Gallery and Team renamed. */
  landingPage: z.boolean().default(false),

  requiredDirectories: z.array(z.string().min(1)),
  optionalDirectories: z.array(z.string()).default([]),
  requiredFiles: z.array(z.string().min(1)).default([]),

  naming: z.object({
    componentPrefix: z.string().default("{TemplatePascal}"),
    stripSuffixes: z.array(z.string()).default(["Section", "Component", "Block", "Widget"]),
    sectionTypeAliases: z.record(z.string()).default({}),
    /**
     * Section types the host editor knows (its `sectionRegistry` variant keys are `<Type>-<n>`).
     * Unknown types still import, but the editor cannot give them a dedicated panel; the
     * validator warns so they can be aliased.
     */
    hostSectionTypes: z.array(z.string()).default([]),
    folderBySectionType: z.record(z.string()).default({}),
    defaultFolder: z.string().default("page"),
    defaultScope: z.string().default("shared"),
  }),

  sources: z.object({
    componentDirs: z.array(z.string()).default(["components", "src/components"]),
    pageDirs: z.array(z.string()).default(["app", "src/app", "pages", "src/pages"]),
    dataDirs: z.array(z.string()).default(["data", "src/data", "content"]),
    uiPrimitiveDirs: z.array(z.string()).default(["components/ui", "src/components/ui"]),
  }),

  mappings: z.array(mappingRuleSchema).min(1),

  exclude: z.object({
    directories: z.array(z.string()).default([]),
    files: z.array(z.string()).default([]),
    boilerplateAssets: z.array(z.string()).default([]),
    /** Files whose content matches one of these regexes are excluded as secrets. */
    secretContentPatterns: z.array(z.string()).default([]),
  }),

  conflicts: z.object({
    /** What to do when two sources map to one target. */
    policy: z.enum(["rename", "skip", "error"]).default("rename"),
    renamePattern: z.string().default("{stem}-{n}{ext}"),
    /** What to do when the output template folder already exists. */
    existingOutputPolicy: z.enum(["replace", "error", "version"]).default("replace"),
  }),

  transformations: z.object({
    renameComponentIdentifier: z.boolean().default(true),
    rewriteSiblingImports: z.boolean().default(true),
    rewriteAssetPaths: z.boolean().default(true),
    extractEditorFields: z.boolean().default(true),
    resolveDefaultContent: z.boolean().default(true),
    ensureDefaultExport: z.boolean().default(true),
    appendEditorFieldsStatic: z.boolean().default(true),
    /** Add every key of the matched defaultContent to editorFields (reference: fields == content keys). */
    editorFieldsFromDefaultContent: z.boolean().default(true),
    /** Ensure every editor field exists in defaultContent ("" / [] / {} by inferred usage). */
    fillMissingEditorFields: z.boolean().default(true),
    /** Components that never read a `data` prop are utilities, not sections; leave them out. */
    skipComponentsWithoutEditorFields: z.boolean().default(true),
    /**
     * Seed missing/empty fields in the shape the component reads (`{label:""}`, `[{title:""}]`)
     * instead of bare `{}` / `[]`, which the host editor renders as nothing / cannot add items to.
     */
    seedFieldShapes: z.boolean().default(true),
    /** Internal keys kept in defaultContent but never offered as editor fields. */
    excludeEditorFields: z.array(z.string()).default(["id", "slug", "key", "_id", "__typename"]),
    /**
     * Rename content keys to the host editor's vocabulary, consistently in code + defaultContent +
     * editorFields (see lib/themeforge/fieldAliases.ts for the safety rules).
     */
    hostFieldAliases: z
      .object({
        enabled: z.boolean().default(true),
        camelCase: z.boolean().default(true),
        fields: z.record(z.string()).default({}),
        bySectionType: z.record(z.record(z.string())).default({}),
      })
      .default({}),
    /**
     * Reference components self-inject the theme's `:root` custom properties
     * (`<style id="theme-upload-css-vars">`) because the host never loads the repo's globals.css.
     */
    injectCssVars: z
      .object({
        enabled: z.boolean().default(true),
        styleId: z.string().min(1).default("theme-upload-css-vars"),
      })
      .default({}),
    /**
     * Reference components pass `data` through a host helper that rewrites `assets/`-relative
     * paths in defaultContent to the uploaded URLs. The module lives in the host, not the theme.
     */
    hostAssetMapper: z
      .object({
        enabled: z.boolean().default(true),
        importPath: z.string().min(1).default("../../../lib/restaurantFoodAssets"),
        importName: z.string().regex(/^[A-Za-z_$][\w$]*$/).default("mapThemeUploadAssetsInData"),
      })
      .default({}),
  }),

  assets: z
    .object({
      optimizeImages: z
        .object({
          enabled: z.boolean().default(true),
          /** Downscale images wider than this (0 = never resize). */
          maxWidth: z.number().int().nonnegative().default(1920),
          jpegQuality: z.number().int().min(1).max(100).default(80),
          webpQuality: z.number().int().min(1).max(100).default(80),
          avifQuality: z.number().int().min(1).max(100).default(60),
          /** Quantize PNGs to a palette (lossy but much smaller for graphics). */
          pngPalette: z.boolean().default(true),
          pngQuality: z.number().int().min(1).max(100).default(85),
          /** Leave files below this size untouched. */
          minBytes: z.number().int().nonnegative().default(10 * 1024),
        })
        .default({}),
    })
    .default({}),

  validation: z.object({
    maxFileSizeMB: z.number().positive().default(25),
    requireAtLeastOneComponent: z.boolean().default(true),
    forbiddenExtensions: z.array(z.string()).default([]),
  }),

  themeJson: z.object({
    multiPageType: z.string().default("Multiple Pages Website"),
    singlePageType: z.string().default("Single Page Website"),
    previewImagePreference: z.array(z.string()).default(["banner", "hero", "home"]),
    addons: z.record(z.unknown()).default({}),
  }),
});

export type ThemeSpec = z.infer<typeof themeSpecSchema>;
export type MappingRule = z.infer<typeof mappingRuleSchema>;

export interface TemplateSummary {
  id: string;
  name: string;
  description?: string;
  version: number;
  file: string;
  requiredDirectories: string[];
  mappingCount: number;
  valid: boolean;
  error?: string;
}

/** Copy bundled specs into <home>/templates when they are missing. Never overwrites user edits. */
export async function ensureTemplatesSeeded(): Promise<void> {
  const cfg = getConfig();
  await fs.mkdir(cfg.templatesDir, { recursive: true });
  let bundled: string[] = [];
  try {
    bundled = (await fs.readdir(cfg.bundledTemplatesDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const f of bundled) {
    const dest = path.join(cfg.templatesDir, f);
    try {
      await fs.access(dest);
    } catch {
      await fs.copyFile(path.join(cfg.bundledTemplatesDir, f), dest);
    }
  }
}

export async function listTemplates(): Promise<TemplateSummary[]> {
  const cfg = getConfig();
  await ensureTemplatesSeeded();
  const files = (await fs.readdir(cfg.templatesDir)).filter((f) => f.endsWith(".json")).sort();
  const out: TemplateSummary[] = [];
  for (const f of files) {
    const file = path.join(cfg.templatesDir, f);
    const id = f.replace(/\.json$/, "");
    try {
      const spec = themeSpecSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
      out.push({
        id,
        name: spec.name,
        description: spec.description,
        version: spec.version,
        file,
        requiredDirectories: spec.requiredDirectories,
        mappingCount: spec.mappings.length,
        valid: true,
      });
    } catch (err) {
      out.push({
        id,
        name: id,
        version: 0,
        file,
        requiredDirectories: [],
        mappingCount: 0,
        valid: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

export async function loadSpec(id = "default-theme"): Promise<ThemeSpec> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid template id: ${id}`);
  const cfg = getConfig();
  await ensureTemplatesSeeded();
  const file = path.join(cfg.templatesDir, `${id}.json`);
  const raw = await fs.readFile(file, "utf8");
  return themeSpecSchema.parse(JSON.parse(raw));
}

export function parseSpec(json: unknown): ThemeSpec {
  return themeSpecSchema.parse(json);
}
