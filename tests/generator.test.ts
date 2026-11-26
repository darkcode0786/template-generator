import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runGeneration, type GenerationResult, type StageId } from "@/lib/themeforge/generator";
import type { ThemeSpec } from "@/lib/themeforge/spec";
import { createSyntheticNextRepo, loadBundledSpec, makeTempDir } from "./helpers";

let work: string;
let repo: string;
let outputRoot: string;
let spec: ThemeSpec;
let result: GenerationResult;
const stageEvents: { stage: StageId; status: string }[] = [];

const input = { repoUrl: "https://github.com/example/synthetic-site", category: "Repairing & Maintenance", template: "computer-repairing", specId: "default-theme" };

beforeAll(async () => {
  work = await makeTempDir("themeforge-gen-");
  repo = path.join(work, "repo");
  outputRoot = path.join(work, "output");
  await fs.mkdir(repo);
  await createSyntheticNextRepo(repo);
  spec = await loadBundledSpec();
  result = await runGeneration(
    "11111111-1111-1111-1111-111111111111",
    input,
    { onStage: (stage, status) => stageEvents.push({ stage, status }) },
    { localRepoDir: repo, spec, outputRoot, tempRoot: path.join(work, "tmp") },
  );
});
afterAll(() => fs.rm(work, { recursive: true, force: true }));

const exists = (p: string) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);
const readJson = async (p: string) => JSON.parse(await fs.readFile(p, "utf8"));

describe("runGeneration (synthetic Next.js repo)", () => {
  it("writes output under <root>/<category-slug>/<template-slug>", () => {
    expect(result.outputDir).toBe(path.join(outputRoot, "repairing-and-maintenance", "computer-repairing"));
  });

  it("creates the required structure from the reference theme", async () => {
    for (const rel of ["theme.json", "addons/floating.json", "assets", "components"]) {
      expect(await exists(path.join(result.outputDir, rel)), rel).toBe(true);
    }
    expect(await readJson(path.join(result.outputDir, "addons", "floating.json"))).toEqual({ floatingItems: [] });
  });

  it("names components <TemplatePascal><SectionType><n> with component.json", async () => {
    const names = (await fs.readdir(path.join(result.outputDir, "components"))).sort();
    expect(names).toEqual(["ComputerRepairingBanner1", "ComputerRepairingBreadcrumb1", "ComputerRepairingFooter1", "ComputerRepairingHeader1", "ComputerRepairingServices1", "ComputerRepairingTopbar1"]);
    const cj = await readJson(path.join(result.outputDir, "components", "ComputerRepairingBanner1", "component.json"));
    expect(cj).toMatchObject({ key: "ComputerRepairingBanner1", name: "ComputerRepairingBanner1", sectionType: "Banner", sectionNumber: 1, scope: "shared", folder: "banner" });
    expect(cj.editorFields).toEqual(expect.arrayContaining(["imageMain", "title", "subtitle"]));
    // default content was found in data/templates.json and asset paths rewritten to assets-relative
    expect(cj.defaultContent).toMatchObject({ title: "Hello", imageMain: "assets/banner/banner.webp", previousLabel: "Prev", buttonText: "View Details", quoteIcon: "quote" });
    expect(cj.editorFields).not.toContain("previousLabel");
    expect(cj.editorFields).not.toContain("buttonText");
    expect(cj.editorFields).not.toContain("quoteIcon");
  });

  it("satisfies the host contract: editorFields ⊆ defaultContent keys, both non-empty", async () => {
    const dirs = await fs.readdir(path.join(result.outputDir, "components"));
    for (const d of dirs) {
      const cj = await readJson(path.join(result.outputDir, "components", d, "component.json"));
      expect(cj.editorFields.length, d).toBeGreaterThan(0);
      expect(Object.keys(cj.defaultContent).length, d).toBeGreaterThan(0);
      for (const f of cj.editorFields) expect(cj.defaultContent, `${d}.${f}`).toHaveProperty(f);
    }
    // Header reads data.menu but the data file only provides logo + menu; nothing missing. Breadcrumb has title only.
    const header = await readJson(path.join(result.outputDir, "components", "ComputerRepairingHeader1", "component.json"));
    expect(header.defaultContent).toHaveProperty("topbar", ""); // data?.topbar is absent in the data file -> filled with an empty default
    expect(header.editorFields).toEqual(expect.arrayContaining(["topbar", "logo", "menu"]));
    expect(header.editorFields.indexOf("topbar")).toBeLessThan(header.editorFields.indexOf("logo"));
    expect(header.editorFields.indexOf("logo")).toBeLessThan(header.editorFields.indexOf("menu"));
    expect(header.defaultContent.logo).toBe("assets/main-logo/header-logo.webp");
    expect(header.defaultContentSource ?? result.manifest.components.find((c) => c.name === "ComputerRepairingHeader1")?.defaultContentSource).toMatch(/SyntheticHeader1$/);
    expect(result.manifest.validation.checks.find((c) => c.name.includes("host contract"))?.ok).toBe(true);
  });

  it("seeds hollow/missing fields in the shape the component reads (host editor fit)", async () => {
    const hero = await readJson(path.join(result.outputDir, "components", "ComputerRepairingBanner1", "component.json"));
    expect(hero.defaultContent.badge).toEqual({ label: "", value: "" }); // was {} in the data file
    expect(hero.defaultContent.cards).toEqual([{ id: "item-1", title: "", description: "" }]); // was []
    expect(hero.defaultContent.linksRight).toEqual([{ id: "item-1", label: "", url: "" }]); // missing; borrowed from linksLeft
    expect(hero.editorFields).toEqual(expect.arrayContaining(["badge", "cards", "linksLeft", "linksRight"]));
    const detail = await readJson(path.join(result.outputDir, "components", "ComputerRepairingServices1", "component.json"));
    expect(detail.editorFields).not.toContain("id");
    expect(result.manifest.validation.checks.find((c) => c.name.startsWith("section types known to host"))?.ok).toBe(true);
  });

  it("reads content JSON outside sources.dataDirs (e.g. components/data/data.json) but not public/ manifests", async () => {
    const crumb = await readJson(path.join(result.outputDir, "components", "ComputerRepairingBreadcrumb1", "component.json"));
    expect(crumb.defaultContent).toEqual({ title: "Breadcrumb from components/data" });
    const detail = result.manifest.components.find((c) => c.name === "ComputerRepairingBreadcrumb1");
    expect(detail?.defaultContentSource).toBe("components/data/data.json#common.Breadcrumb");
  });

  it("skips test files matched by the component rule's ignore list", async () => {
    expect(await exists(path.join(result.outputDir, "components", "ComputerRepairingServicesTest1"))).toBe(false);
    expect(result.manifest.included.some((f) => f.source.includes("services.test.tsx"))).toBe(false);
  });

  it("renames the component identifier, rewrites sibling imports and reports unresolved ones", async () => {
    const header = await fs.readFile(path.join(result.outputDir, "components", "ComputerRepairingHeader1", "ComputerRepairingHeader1.tsx"), "utf8");
    expect(header).toContain("export const ComputerRepairingHeader1");
    expect(header).toMatch(/import ComputerRepairingTopbar1 from ['"]\.\.\/ComputerRepairingTopbar1\/ComputerRepairingTopbar1['"];/);
    expect(header).toContain("<ComputerRepairingTopbar1 ");
    expect(header).toMatch(/export default ComputerRepairingHeader1;/);
    expect(header).toContain('href={toLestowHref("/")}');
    expect(header).not.toContain("next/link");

    const topbar = await fs.readFile(path.join(result.outputDir, "components", "ComputerRepairingTopbar1", "ComputerRepairingTopbar1.tsx"), "utf8");
    expect(topbar).toMatch(/editorFields = \["phoneValue","emailValue"\]/);

    const unresolved = result.manifest.unresolvedImports.map((u) => `${u.component}:${u.specifier}`);
    expect(unresolved).not.toContain("ComputerRepairingTopbar1:@/types/templates.types");
    expect(topbar).toContain("interface TopBarData {");
    expect(topbar).toContain("type SocialLink =");
    expect(topbar).not.toContain("UnusedPage");
    expect(topbar).not.toContain("notAType");
    expect(unresolved).toContain("ComputerRepairingServices1:@/lib/missing-helper");
    expect(result.manifest.dependencies).toMatchObject({ "react-icons": "^5.0.0", "framer-motion": "unknown" });
  });

  it("places images, icons and fonts deterministically", async () => {
    const targets = result.manifest.included.map((f) => f.target);
    expect(targets).toEqual(
      expect.arrayContaining([
        "assets/banner/banner.webp",
        "assets/team/1.jpg",
        "assets/main-logo/header-logo.webp",
        "assets/service/laptop/01.webp",
        "assets/icons/icons/star.svg",
      ]),
    );
    expect(targets.some((t) => t.startsWith("styles/") || t.endsWith("next.svg"))).toBe(false);
  });

  it("keeps global colors in theme.json and does not export a styles folder", async () => {
    expect(await exists(path.join(result.outputDir, "styles"))).toBe(false);
    expect(result.manifest.included.some((f) => f.kind === "style" || f.kind === "font" || f.target.startsWith("styles/"))).toBe(false);
    const theme = JSON.parse(await fs.readFile(path.join(result.outputDir, "theme.json"), "utf8"));
    expect(theme.variables["--primary-bg"]).toBe("#123456");
    expect(theme.variables["--color-primary"]).toBe("var(--primary-bg)");
  });

  it("injects the reference host boilerplate: CSS-var injector and asset mapper", async () => {
    const header = await fs.readFile(path.join(result.outputDir, "components", "ComputerRepairingHeader1", "ComputerRepairingHeader1.tsx"), "utf8");
    // no directive in this file -> import is the very first line
    expect(header).toMatch(/^import \{ mapThemeUploadAssetsInData \} from "\.\.\/\.\.\/\.\.\/lib\/computerRepairingAssets";\n/);
    // with a directive, the import must come after it (directives have to stay first)
    const topbar = await fs.readFile(path.join(result.outputDir, "components", "ComputerRepairingTopbar1", "ComputerRepairingTopbar1.tsx"), "utf8");
    expect(topbar).toMatch(/^'use client';\s*\nimport \{ mapThemeUploadAssetsInData \} from "\.\.\/\.\.\/\.\.\/lib\/computerRepairingAssets";\n/);
    // first statements of the component body
    expect(header).toMatch(/data = mapThemeUploadAssetsInData\(data\);/);
    const mapper = await fs.readFile(path.join(result.outputDir, "lib", "computerRepairingAssets.ts"), "utf8");
    const themeJson = JSON.parse(await fs.readFile(path.join(result.outputDir, "theme.json"), "utf8"));
    expect(mapper).toContain("mapThemeUploadAssetsInData");
    expect(mapper).toContain(themeJson.key);
    expect(header).not.toContain("theme-upload-css-vars");
    expect(result.manifest.cssVariables["--primary-bg"]).toBe("#123456");
    expect(result.manifest.cssVariables["--primary-text"]).toBe("#ffffff");
    const theme = JSON.parse(await fs.readFile(path.join(result.outputDir, "theme.json"), "utf8"));
    expect(Object.keys(theme.variables).slice(0, 15)).toEqual([
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
    ]);
    expect(theme.variables["--primary-bg"]).toBe("#123456");
    expect(theme.variables["--color-primary"]).toBe("var(--primary-bg)");
    const banner = await fs.readFile(path.join(result.outputDir, "components", "ComputerRepairingBanner1", "ComputerRepairingBanner1.tsx"), "utf8");
    expect(banner).toContain('className="bg-[var(--color-primary)] text-[var(--color-primary)]"');
    expect(banner).toContain('data-editor-media-overlay="show"');
    expect(banner).not.toContain('style={{ backgroundColor: "var(--color-navy-overlay)" }}');
    expect(banner).toContain('import { mediaSrc } from "../../../lib/lexoraPreview";');
    expect(banner).toContain('src={mediaSrc("/banner/banner.webp")}');
    expect(banner).toContain('url(" + mediaSrc("/service/laptop/01.webp") + ")');
    expect(banner).toContain("url(${data.imageMain})");
    for (const d of await fs.readdir(path.join(result.outputDir, "components"))) {
      const code = await fs.readFile(path.join(result.outputDir, "components", d, `${d}.tsx`), "utf8");
      expect(code, d).toContain('import { mapThemeUploadAssetsInData } from "../../../lib/computerRepairingAssets";');
      expect(code, d).not.toContain("theme-upload-css-vars");
    }
  });

  it("does not copy font files into the export", async () => {
    expect(result.manifest.included.filter((f) => f.kind === "font")).toEqual([]);
    expect(result.manifest.included.some((f) => f.target.startsWith("styles/"))).toBe(false);
  });

  it("never copies secrets, dependencies or archives", async () => {
    const all: string[] = [];
    async function walk(d: string, rel = "") {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(d, e.name), r);
        else all.push(r);
      }
    }
    await walk(result.outputDir);
    expect(all.some((p) => /\.env|id_rsa|keys\.ts|node_modules|\.zip$|\.next|theme-manifest\.json/.test(p))).toBe(false);
  });

  it("builds theme.json with pages, section order and variants", async () => {
    const theme = await readJson(path.join(result.outputDir, "theme.json"));
    expect(theme.key).toMatch(/^computer-repairing-\d{14}$/);
    expect(theme.title).toBe("Computer Repairing");
    expect(theme.previewDescription).toBe("Computer Repairing template");
    expect(theme.categorySlug).toBe("repairing-and-maintenance");
    expect(theme.type).toBe("Multiple Pages Website");
    expect(theme.previewImage).toBe("assets/preview.webp");
    expect(theme.homeSectionOrder).toEqual(["Topbar", "Header", "Banner", "Services", "Footer"]);
    expect(theme.sectionVariants).toMatchObject({ Topbar: "ComputerRepairingTopbar1", Banner: "ComputerRepairingBanner1", Footer: "ComputerRepairingFooter1" });
    const about = theme.pages.find((p: { id: string }) => p.id === "about");
    expect(about).toMatchObject({ label: "About Us", sections: ["Topbar", "Header", "Breadcrumb", "Footer"] });
    expect(theme.pages.map((p: { id: string }) => p.id)).toEqual(["home", "contact", "about", "services-id-detail"]);
    expect(theme.pages.find((p: { id: string }) => p.id === "contact")).toMatchObject({ label: "Contact Us", sections: ["Topbar", "Header", "Breadcrumb", "Footer"] });
    expect(theme.pages.find((p: { id: string }) => p.id === "home")?.sections).toEqual(theme.homeSectionOrder);
  });

  it("passes validation and records it in the manifest", () => {
    expect(result.manifest.validation.ok).toBe(true);
    expect(result.manifest.validation.checks.every((c) => c.ok || c.name.startsWith("previewImage"))).toBe(true);
    expect(result.manifest.errors).toEqual([]);
  });

  it("creates a ZIP next to the output folder", async () => {
    expect(result.zipPath).toBe(path.join(outputRoot, "repairing-and-maintenance", "computer-repairing.zip"));
    const buf = await fs.readFile(result.zipPath);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(result.zipBytes).toBe(buf.length);
    expect(buf.length).toBeGreaterThan(500);
  });

  it("reports real stage transitions", () => {
    const done = stageEvents.filter((e) => e.status === "done").map((e) => e.stage);
    expect(done).toEqual(expect.arrayContaining(["validate", "spec", "scan", "detect", "map", "copy", "manifest", "validate-output", "zip"]));
    expect(stageEvents.find((e) => e.stage === "clone")?.status).toBe("running");
    expect(stageEvents.some((e) => e.stage === "cleanup" && e.status === "skipped")).toBe(true);
  });

  it("replaces an existing output folder only under the explicit 'replace' policy", async () => {
    const strict: ThemeSpec = { ...spec, conflicts: { ...spec.conflicts, existingOutputPolicy: "error" } };
    await expect(
      runGeneration("22222222-2222-2222-2222-222222222222", input, { onStage: () => undefined }, { localRepoDir: repo, spec: strict, outputRoot, tempRoot: path.join(work, "tmp") }),
    ).rejects.toThrow(/already exists/);
  });

  it("does not treat unexported font files as a target conflict", async () => {
    const strict: ThemeSpec = { ...spec, conflicts: { ...spec.conflicts, policy: "error" } };
    const generated = await runGeneration(
      "33333333-3333-3333-3333-333333333333",
      { ...input, template: "conflict-check" },
      { onStage: () => undefined },
      { localRepoDir: repo, spec: strict, outputRoot, tempRoot: path.join(work, "tmp") },
    );
    expect(generated.manifest.errors).toEqual([]);
    expect(generated.manifest.included.some((f) => f.kind === "font" || f.target.startsWith("styles/"))).toBe(false);
  });
});

describe("failure handling and temporary cleanup", () => {
  it("removes the temporary job folder when cloning fails", async () => {
    const tempRoot = path.join(work, "tmp-fail");
    const jobId = "44444444-4444-4444-4444-444444444444";
    const events: { stage: StageId; status: string; detail?: string }[] = [];
    // github.com resolves publicly but the repository does not exist, so git exits non-zero quickly.
    await expect(
      runGeneration(
        jobId,
        { ...input, repoUrl: "https://github.com/themeforge-fixture-does-not-exist/nope-nope-nope" },
        { onStage: (stage, status, detail) => events.push({ stage, status, detail }) },
        { spec, outputRoot, tempRoot },
      ),
    ).rejects.toThrow();
    expect(await exists(path.join(tempRoot, jobId))).toBe(false);
    expect(events.some((e) => e.stage === "cleanup" && e.status === "done")).toBe(true);
  }, 90_000);
});
