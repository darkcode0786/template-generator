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

  it("uses the templateFlow manager page id and section type", () => {
    const sectionVariants: Record<string, string> = { ...variants, Gallery: "MyGallery1", GalleryGrid: "MyGalleryGrid1", Team: "MyTeam1", ServiceDetail: "MyServiceDetail1", Services: "MyServices1" };
    const theme = normalizeThemePages(
      [
        { id: "home", label: "Home", sectionType: "Home", sections: ["Header", "Gallery", "Services", "Footer"] },
        { id: "photo-gallery", label: "Gallery", sectionType: "GalleryGrid", sections: ["GalleryGrid"] },
        { id: "team", label: "Team", sectionType: "Team", sections: ["Team"] },
        { id: "service", label: "Services", sectionType: "Services", sections: ["Services"] },
        { id: "services-id-detail", label: "Service", sectionType: "ServiceDetail", sections: ["ServiceDetail"] },
      ],
      sectionVariants,
    );
    expect(theme.pages.find((page) => page.label === "Gallery")).toMatchObject({
      id: "gallery",
      sectionType: "GalleryPage",
      sections: ["Topbar", "Header", "Breadcrumb", "GalleryPage", "Footer"],
    });
    expect(sectionVariants.GalleryPage).toBe("MyGalleryGrid1");
    expect(theme.pages.find((page) => page.label === "Team")).toMatchObject({ id: "teams", sectionType: "TeamPage" });
    expect(sectionVariants.TeamPage).toBe("MyTeam1");
    expect(theme.pages.find((page) => page.label === "Services")).toMatchObject({ id: "services", sectionType: "Services" });
    expect(sectionVariants.ServicePage).toBeUndefined();
    expect(theme.pages.find((page) => page.id === "services-id-detail")?.sectionType).toBe("ServiceDetail");
    expect(theme.homeSectionOrder).toEqual(["Header", "Gallery", "Services", "Footer"]);
  });

  it("uses ServicePage only when the theme has no Services section", () => {
    const sectionVariants: Record<string, string> = { Header: "H", Footer: "F", Service: "MyService1" };
    const theme = normalizeThemePages(
      [{ id: "service", label: "Services", sectionType: "Service", sections: ["Service"] }],
      sectionVariants,
    );
    expect(theme.pages[0]).toMatchObject({ id: "services", sectionType: "ServicePage", sections: ["Header", "ServicePage", "Footer"] });
    expect(sectionVariants.ServicePage).toBe("MyService1");
  });
});

describe("applyEditorMedia", () => {
  it("points an existing scrim at the theme overlay and does not add a second veil", () => {
    const code = applyEditorMedia(
      `<section className="bg-black/60"><img src={data.image} alt="" className="object-cover" /><img src={data.logo} alt="logo" /></section>`,
      "Banner",
    );
    expect(code).toContain('data-editor-media-overlay="show"');
    expect(code).toContain("data-editor-media-src={data.image}");
    expect(code).toContain('data-editor-media-role="logo"');
    expect(code).toContain("bg-[var(--color-navy-overlay)]");
    expect(code).not.toContain('style={{ backgroundColor: "var(--color-navy-overlay)" }}');
    expect(code).not.toContain("var(--color-overlay)");
  });

  it("leaves a footer logo without a covering overlay", () => {
    const code = applyEditorMedia(
      `<footer className="relative"><img src={data.logoImage} alt="logo" className="h-14" /><p>{data.description}</p></footer>`,
      "Footer",
    );
    expect(code).toContain('data-editor-media-role="logo"');
    expect(code).not.toContain("--color-footer-overlay");
  });
});
