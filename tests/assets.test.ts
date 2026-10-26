import { describe, expect, it } from "vitest";
import { keepsRepoHeaderLinks, mediaSrcArg, rewriteAssetStrings, rewriteHardcodedMedia, rewriteSvgModuleImports } from "@/lib/themeforge/transform";

const targets = new Map<string, string>([
  ["public/hero/banner.webp", "assets/hero/banner.webp"],
  ["public/main logo/header logo.webp", "assets/main-logo/header-logo.webp"],
  ["public/gallery/1.webp", "assets/gallery/1.webp"],
]);

describe("rewriteAssetStrings", () => {
  it("writes assets/ paths and accepts the other forms the uploader rewrites", () => {
    const { value, rewritten, strippedBase64 } = rewriteAssetStrings(
      {
        previewImage: "assets/hero/banner.webp",
        image1: "/hero/banner.webp",
        logo: "./assets/main logo/header logo.webp",
        bare: "hero/banner.webp",
        remote: "https://cdn.example.com/hero/banner.webp",
        embedded: "data:image/png;base64,AAAA",
        gallery: [{ image: "/gallery/1.webp" }],
      },
      targets,
    );
    expect(rewritten).toBeGreaterThan(0);
    expect(strippedBase64).toBe(1);
    expect(value).toEqual({
      previewImage: "assets/hero/banner.webp",
      image1: "assets/hero/banner.webp",
      logo: "assets/main-logo/header-logo.webp",
      bare: "assets/hero/banner.webp",
      remote: "https://cdn.example.com/hero/banner.webp",
      embedded: "",
      gallery: [{ image: "assets/gallery/1.webp" }],
    });
  });
});

describe("rewriteHardcodedMedia", () => {
  it("wraps fixed image paths in mediaSrc and leaves data-driven src alone", () => {
    const source = `export const Banner = ({ data }: { data?: any }) => (
      <section style={{ backgroundImage: "url(/hero/banner.webp)" }}>
        <img src="/main logo/header logo.webp" alt={data.imageAlt} />
        <img src={data.image1} alt="" />
        <a href="/contact">Book</a>
      </section>
    );`;
    const { code, count } = rewriteHardcodedMedia(source, targets);
    expect(count).toBe(2);
    expect(code).toContain('src={mediaSrc("/main-logo/header-logo.webp")}');
    expect(code).toContain('url(" + mediaSrc("/hero/banner.webp") + ")');
    expect(code).toContain("src={data.image1}");
    expect(code).toContain('href="/contact"');
    expect(mediaSrcArg("assets/hero/banner.webp")).toBe("/hero/banner.webp");
  });
});

describe("rewriteSvgModuleImports", () => {
  it("renders an imported svg from the copied icon file", () => {
    const icons = new Map([["public/icons/star.svg", "assets/icons/icons/star.svg"]]);
    const { code, count } = rewriteSvgModuleImports(
      `import Star from "../public/icons/star.svg";\nexport const Row = () => <Star className="h-4 w-4" />;`,
      "components/Row.tsx",
      icons,
    );
    expect(count).toBe(1);
    expect(code).not.toContain("import Star");
    expect(code).toContain('src={mediaSrc("/icons/icons/star.svg")}');
    expect(code).toContain('className="h-4 w-4"');
  });
});

describe("keepsRepoHeaderLinks", () => {
  it("does not invent header links", () => {
    expect(keepsRepoHeaderLinks("Header", "navLinksRight")).toBe(true);
    expect(keepsRepoHeaderLinks("Header", "menu")).toBe(true);
    expect(keepsRepoHeaderLinks("Footer", "menu")).toBe(false);
    expect(keepsRepoHeaderLinks("Header", "features")).toBe(false);
  });
});
