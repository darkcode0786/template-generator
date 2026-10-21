import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchesGlob } from "@/lib/themeforge/glob";
import { isInside, isSafeRelativePath, pascalCase, safeJoin, sanitizeAssetTarget, slugify } from "@/lib/themeforge/paths";

const root = path.resolve(process.platform === "win32" ? "C:\\ThemeForgeTest\\out" : "/tmp/themeforge-test/out");

describe("safeJoin / path traversal prevention", () => {
  it("joins normal relative paths", () => {
    expect(safeJoin(root, "assets/team/1.jpg")).toBe(path.join(root, "assets", "team", "1.jpg"));
  });
  it.each(["../x", "a/../../x", "..\\x", "/etc/passwd", "C:\\Windows\\win.ini", "a\0b"])("rejects %s", (p) => {
    expect(() => safeJoin(root, p)).toThrow();
  });
  it("isInside handles siblings with a shared prefix", () => {
    expect(isInside(root, `${root}-evil/file`)).toBe(false);
    expect(isInside(root, path.join(root, "x"))).toBe(true);
    expect(isInside(root, root)).toBe(true);
  });
});

describe("isSafeRelativePath", () => {
  it.each(["assets/a.png", "components/X/X.tsx", "theme.json"])("accepts %s", (p) => expect(isSafeRelativePath(p)).toBe(true));
  it.each(["../a", "a/../b", "/a", "C:/a", "a//b", "a/./b", "con/x.txt", "a?b.png", ""])("rejects %s", (p) => expect(isSafeRelativePath(p)).toBe(false));
});

describe("glob matcher", () => {
  it("supports ** * ? and {a,b}", () => {
    expect(matchesGlob("components/sections/Hero.tsx", "components/**/*.{tsx,jsx}")).toBe(true);
    expect(matchesGlob("components/Hero.tsx", "components/**/*.tsx")).toBe(true);
    expect(matchesGlob("src/components/Hero.tsx", "components/**/*.tsx")).toBe(false);
    expect(matchesGlob("public/a/b/c.PNG", "public/**/*.{png,jpg}")).toBe(true);
    expect(matchesGlob(".env.local", "**/.env.*")).toBe(true);
    expect(matchesGlob("config/.env", "**/.env")).toBe(true);
    expect(matchesGlob("x/id_rsa.pub", "**/id_rsa*")).toBe(true);
    expect(matchesGlob("a/b.ts", "a/?.ts")).toBe(true);
  });
});

describe("sanitizeAssetTarget", () => {
  it("turns spaces into hyphens and keeps the assets prefix", () => {
    expect(sanitizeAssetTarget("assets/main logo/header logo.webp")).toBe("assets/main-logo/header-logo.webp");
    expect(sanitizeAssetTarget("assets/hero/banner.webp")).toBe("assets/hero/banner.webp");
    expect(sanitizeAssetTarget("assets/gallery/1.webp")).toBe("assets/gallery/1.webp");
  });
});

describe("naming helpers", () => {
  it("slugifies category names", () => {
    expect(slugify("Repairing & Maintenance")).toBe("repairing-and-maintenance");
    expect(slugify("  Law Firm  ")).toBe("law-firm");
  });
  it("pascal-cases template names", () => {
    expect(pascalCase("computer-repairing")).toBe("ComputerRepairing");
    expect(pascalCase("modern store")).toBe("ModernStore");
    expect(pascalCase("HeroSection")).toBe("HeroSection");
  });
});
