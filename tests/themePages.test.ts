import { describe, expect, it } from "vitest";
import { applyEditorMedia } from "@/lib/themeforge/editorMedia";
import { normalizeThemePages } from "@/lib/themeforge/themePages";

const variants = {
  Topbar: "MyTopbar1",
  Header: "MyHeader1",
  Banner: "MyBanner1",
  About: "MyAbout1",
  Services: "MyServices1",
  Footer: "MyFooter1",
  Breadcrumb: "MyBreadcrumb1",
};

describe("normalizeThemePages", () => {
  it("keeps home on homeSectionOrder and gives inner pages a filled stack of variant keys", () => {
    const theme = normalizeThemePages(
      [
        { id: "home", label: "Home", sectionType: "Home", sections: ["Header", "Banner", "About", "Footer"] },
        { id: "about", label: "About", sectionType: "AboutPage", sections: ["About"] },
        { id: "services", label: "Services", sectionType: "Services", sections: [] },
        { id: "orphan", label: "Orphan", sectionType: "AboutPage", sections: ["NotASection"] },
      ],
      variants,
    );
    expect(theme.homeSectionOrder).toEqual(["Header", "Banner", "About", "Footer"]);
    expect(theme.pages.find((page) => page.id === "home")?.sections).toEqual(theme.homeSectionOrder);
    expect(theme.pages.find((page) => page.id === "about")).toEqual({
      id: "about",
      label: "About",
      sectionType: "About",
      sections: ["Topbar", "Header", "Breadcrumb", "About", "Footer"],
    });
    expect(theme.pages.find((page) => page.id === "services")).toBeUndefined();
    expect(theme.pages.find((page) => page.id === "orphan")?.sections).toEqual(["Topbar", "Header", "Breadcrumb", "Footer"]);
    expect(theme.pages.find((page) => page.id === "orphan")?.sectionType).not.toBe("AboutPage");
  });
});

describe("applyEditorMedia", () => {
  it("marks photos for the editor overlay and veils a banner image with the theme variable", () => {
    const code = applyEditorMedia(
      `<section className="bg-black/60"><img src={data.image} alt="" className="object-cover" /><img src={data.logo} alt="logo" /></section>`,
      "Banner",
    );
    expect(code).toContain('data-editor-media-overlay="show"');
    expect(code).toContain("data-editor-media-src={data.image}");
    expect(code).toContain('data-editor-media-role="logo"');
    expect(code).toContain("bg-[var(--color-navy-overlay)]");
    expect(code).toContain('style={{ backgroundColor: "var(--color-navy-overlay)" }}');
    expect(code).not.toContain("var(--color-overlay)");
  });
});
