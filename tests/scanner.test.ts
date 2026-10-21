import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanRepository } from "@/lib/themeforge/scanner";
import type { ThemeSpec } from "@/lib/themeforge/spec";
import type { ScanResult } from "@/lib/themeforge/types";
import { createSyntheticNextRepo, loadBundledSpec, makeTempDir } from "./helpers";

let repo: string;
let spec: ThemeSpec;
let scan: ScanResult;

beforeAll(async () => {
  repo = await makeTempDir();
  await createSyntheticNextRepo(repo);
  spec = await loadBundledSpec();
  scan = await scanRepository(repo, spec);
});
afterAll(() => fs.rm(repo, { recursive: true, force: true }));

describe("scanRepository", () => {
  const included = () => scan.files.map((f) => f.path);
  const excludedPaths = () => scan.excluded.map((e) => e.path);

  it("excludes secrets by name and by content", () => {
    expect(excludedPaths()).toEqual(expect.arrayContaining([".env", ".env.local", "secrets/id_rsa", "lib/keys.ts"]));
    expect(included()).not.toContain(".env");
    expect(included()).not.toContain("lib/keys.ts");
    expect(scan.excluded.find((e) => e.path === "lib/keys.ts")?.reason).toMatch(/secret pattern/);
  });

  it("excludes dependencies, build output, archives and boilerplate", () => {
    expect(excludedPaths()).toEqual(expect.arrayContaining(["node_modules/", ".next/", "public/partner.zip", "public/next.svg"]));
    expect(included().some((p) => p.startsWith("node_modules/"))).toBe(false);
  });

  it("classifies files", () => {
    const by = Object.fromEntries(scan.files.map((f) => [f.path, f.category]));
    expect(by["components/sections/HeroSection.tsx"]).toBe("component");
    expect(by["app/page.tsx"]).toBe("page");
    expect(by["app/layout.tsx"]).toBe("layout");
    expect(by["app/globals.css"]).toBe("style");
    expect(by["public/team/1.jpg"]).toBe("image");
    expect(by["public/icons/star.svg"]).toBe("icon");
    expect(by["public/fonts/Inter.woff2"]).toBe("font");
    expect(by["data/templates.json"]).toBe("data");
    expect(by["package.json"]).toBe("config");
  });

  it("detects the framework and languages", () => {
    expect(scan.project.framework).toBe("Next.js");
    expect(scan.project.frameworkVersion).toBe("16.0.0");
    expect(scan.project.languages).toEqual(expect.arrayContaining(["TypeScript", "CSS"]));
    expect(scan.project.styling.join()).toMatch(/Tailwind/);
    expect(scan.project.hasAppRouter).toBe(true);
    expect(scan.project.packageName).toBe("synthetic-site");
  });

  it("enforces the file-count limit", async () => {
    await expect(scanRepository(repo, spec, { maxFiles: 3 })).rejects.toThrow(/more than 3 files/);
  });

  it("enforces the size limit", async () => {
    await expect(scanRepository(repo, spec, { maxBytes: 100 })).rejects.toThrow(/exceeds/);
  });

  it("does not follow symlinks", async () => {
    const linkRepo = await makeTempDir();
    try {
      await fs.writeFile(path.join(linkRepo, "real.tsx"), "export const A = () => null;");
      try {
        await fs.symlink(path.join(linkRepo, "real.tsx"), path.join(linkRepo, "link.tsx"), "file");
      } catch {
        return; // symlink creation needs privileges on some Windows setups; skip quietly
      }
      const r = await scanRepository(linkRepo, spec);
      expect(r.files.map((f) => f.path)).toEqual(["real.tsx"]);
      expect(r.excluded.find((e) => e.path === "link.tsx")?.reason).toMatch(/symlink/);
    } finally {
      await fs.rm(linkRepo, { recursive: true, force: true });
    }
  });
});
