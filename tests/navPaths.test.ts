import { describe, expect, it } from "vitest";
import { rewriteInternalNavPaths } from "@/lib/themeforge/navPaths";

describe("rewriteInternalNavPaths", () => {
  const pages = ["home", "about", "gallery", "teams", "services", "blogs"];

  it("points renamed routes at the page id the editor opens", () => {
    const source = `href="/team" href={toLestowHref("/photo-gallery")} url: "/our-services"`;
    expect(rewriteInternalNavPaths(source, pages)).toBe(
      `href="/teams" href={toLestowHref("/gallery")} url: "/services"`,
    );
  });

  it("leaves real page paths, assets, and external urls alone", () => {
    const source = `href="/about" src="/hero/banner.webp" href="https://example.com/team"`;
    expect(rewriteInternalNavPaths(source, pages)).toBe(source);
  });
});
