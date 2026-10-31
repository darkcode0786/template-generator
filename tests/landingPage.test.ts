import { describe, expect, it } from "vitest";
import { bindPreviewNavClicks, rewriteHeaderNavHrefs, rewritePreviewHrefs } from "@/lib/themeforge/themeIcons";
import { mappedCollectionFields, orderEditorFields, pruneUnreadContent } from "@/lib/themeforge/editorContent";
import {
  applyLandingPlan,
  ensureSectionAnchor,
  isLandingSite,
  landingAnchorFor,
  landingMenuHref,
  landingPrefix,
  landingSectionType,
  pinLandingColors,
  renderIndexNumbers,
  rewriteLandingDynamicHrefs,
  rewriteLandingLinks,
  rewriteLandingLiteralHrefs,
} from "@/lib/themeforge/landingPage";
import type { MappingPlan } from "@/lib/themeforge/types";

describe("landing page template", () => {
  it("names a unique gallery type and keeps the one home page", () => {
    expect(landingPrefix("wedding-planner-2")).toBe("Wed");
    expect(landingSectionType("Gallery", "Wed")).toBe("WedGallery");
    expect(landingSectionType("Team", "Pet")).toBe("PetTeam");
    expect(landingSectionType("About", "Wed")).toBe("About");
    expect(landingAnchorFor("Banner")).toBe("home");
    expect(landingAnchorFor("Testimonial")).toBe("testimonials");
    expect(landingAnchorFor("About")).toBe("about");
    expect(landingAnchorFor("Contact")).toBe("contact");
    expect(landingAnchorFor("WedGallery")).toBe("gallery");
    expect(landingAnchorFor("Header")).toBeNull();
    expect(isLandingSite([{ id: "home", sections: ["Header", "Banner"] }])).toBe(true);
    expect(isLandingSite([{ id: "home", sections: ["Banner"] }, { id: "about", sections: ["About"] }])).toBe(false);
  });

  it("renames gallery on the plan and points menu links at section hashes", () => {
    const plan = {
      files: [],
      components: [{ source: "a", baseName: "Gallery", sectionType: "Gallery", sectionNumber: 1, name: "WedGallery1", folder: "gallery", scope: "shared", targetDir: "components/WedGallery1", targetFile: "WedGallery1.tsx" }],
      pages: [{ id: "home", label: "Home", sectionType: "Home", route: "/", source: "app/page.tsx", sections: ["Header", "Banner", "Gallery", "Contact", "Footer"], unresolvedComponents: [] }],
      skipped: [],
      warnings: [],
    } satisfies MappingPlan;
    expect(applyLandingPlan(plan, "wedding-planner-2")).toBe(true);
    expect(plan.components[0].sectionType).toBe("WedGallery");
    expect(plan.pages[0].sections).toContain("WedGallery");
    const multi = {
      files: [],
      components: [],
      pages: [
        { id: "home", label: "Home", sectionType: "Home", route: "/", source: "app/page.tsx", sections: ["Header", "Banner", "Footer"], unresolvedComponents: [] },
        { id: "gallery", label: "Gallery", sectionType: "GalleryPage", route: "/gallery", source: "app/gallery/page.tsx", sections: ["Header", "Breadcrumb", "Gallery", "Footer"], unresolvedComponents: [] },
        { id: "services-id-detail", label: "Service", sectionType: "ServiceDetail", route: "/services/[id]", source: "app/services/[id]/page.tsx", sections: ["Header", "ServiceDetail", "Footer"], unresolvedComponents: [] },
      ],
      skipped: [],
      warnings: [],
    } satisfies MappingPlan;
    expect(applyLandingPlan(multi, "petlimb", true)).toBe(true);
    expect(multi.pages.map((page) => page.id)).toEqual(["home"]);
    expect(multi.pages[0].sections).toEqual(["Header", "Banner", "PetGallery", "Footer"]);
    const anchors = new Set(["home", "gallery", "contact"]);
    expect(landingMenuHref("/about", "About Us", anchors)).toBe("/about");
    expect(landingMenuHref("/about", "About Us", new Set(["about", "home"]))).toBe("#about");
    expect(landingMenuHref("/gallery", "Gallery", anchors)).toBe("#gallery");
    expect(landingMenuHref("mailto:hello@example.com", "Email", anchors)).toBe("mailto:hello@example.com");
    expect(landingMenuHref("/", "Home", anchors)).toBe("#home");
    expect(landingMenuHref("#testimonials", "Testimonials", new Set(["home", "about", "testimonial"]))).toBe("#testimonials");
    expect(landingMenuHref("#why-choose-us", "Why Choose Us", new Set(["home"]))).toBe("#why-choose-us");
    const sourceMenu = [
      { id: "nl-about", label: "About Us", url: "#about" },
      { id: "nl-services", label: "Services", url: "#services" },
      { id: "nl-why-choose-us", label: "Why Choose Us", url: "#why-choose-us" },
      { id: "nl-impact", label: "Impact", url: "#impact" },
      { id: "nl-team", label: "Team", url: "#team" },
      { id: "nl-gallery", label: "Gallery", url: "#gallery" },
      { id: "nl-testimonials", label: "Testimonials", url: "#testimonials" },
    ];
    const content = rewriteLandingLinks({ menu: [...sourceMenu, { label: "Contact", url: "/contact" }], logo: "/logo.webp" }, anchors) as { menu: { id?: string; url: string }[] };
    expect(content.menu).toHaveLength(sourceMenu.length + 1);
    expect(content.menu.slice(0, sourceMenu.length).map((item) => item.url)).toEqual(sourceMenu.map((item) => item.url));
    expect(content.menu.at(-1)?.url).toBe("#contact");
    expect(content.logo).toBe("/logo.webp");
    const header = rewriteLandingDynamicHrefs(`"use client";\nimport { toLestowHref } from "../../../lib/lexoraPreview";\nexport const Header = ({ data }) => <a href={toLestowHref(linkHref)}>{data.menu.length}</a>;\n`);
    expect(header).toContain("function landingSectionHref");
    expect(header).toContain("href={landingSectionHref(linkHref)}");
    expect(header).toContain("raw.startsWith(\"#\")");
    expect(header).toContain("import { toLestowHref }");
  });

  it("puts the section id on the block and numbers cards from the list index", () => {
    expect(ensureSectionAnchor(`<section className="py-10">`, "About")).toContain('id="about"');
    expect(ensureSectionAnchor(`<section id="about" className="py-10">`, "About")).toContain('id="about"');
    const code = renderIndexNumbers(`{items.map((item, index) => <span>{item.number}</span>)}`, "FAQ");
    expect(code).toContain("String(index + 1).padStart(2, \"0\")");
    expect(code).not.toContain("item.number");
    expect(orderEditorFields(["image", "imageAlt", "title", "description", "logo", "logoAlt", "items", "backgroundImage", "backgroundImageAlt"], { items: [{ title: "A" }] })).toEqual(["title", "description", "image", "imageAlt", "logo", "logoAlt", "items", "backgroundImage", "backgroundImageAlt"]);
  });

  it("keeps text colours pinned and scrolls header clicks to the section hash", () => {
    const colors = pinLandingColors({
      "--primary-bg": "#0f2c20",
      "--blue-bg": "#1e4d3a",
      "--secondary-bg": "#ffffff",
      "--secondary-text": "#333d37",
      "--header-text": "#0f172a",
      "--color-text-light": "#64746d",
    });
    expect(colors["--color-primary"]).toBe("var(--primary-bg)");
    expect(colors["--color-bg-main"]).toBe("var(--secondary-bg)");
    expect(colors["--color-heading"]).toBe("#0f172a");
    expect(colors["--color-text"]).toBe("#333d37");
    const code = bindPreviewNavClicks(rewriteLandingLiteralHrefs(rewriteHeaderNavHrefs(rewritePreviewHrefs(`export const Header = ({ data }: { data?: any }) => {
  return <a href={toLestowHref("/")}><img /></a>;
};`)), new Set(["home"])), true);
    expect(code).toContain('href="#home"');
    expect(code).toContain("event.stopPropagation()");
    expect(code).toContain('data-editor-no-inline="true"');
    expect(code).toContain("mailto:|tel:|https?:");
    expect(code).not.toContain("#page-");
  });

  it("drops unread json keys and keeps mapped lists addable", () => {
    const source = `export const FAQ = ({ data }: { data?: any }) => (
      <section>
        <h2>{data.title}</h2>
        <p>{data.unusedNote}</p>
        {data.faqs.map((item) => <article key={item.id}><h3>{item.question}</h3><p>{item.answer}</p></article>)}
      </section>
    );`;
    const pruned = pruneUnreadContent(
      {
        title: "Questions",
        spare: "not on the page",
        faqs: [{ id: "1", question: "Q", answer: "A", number: "01", icon: "star" }],
      },
      source.replace("<p>{data.unusedNote}</p>\n        ", ""),
    );
    expect(pruned.removed).toEqual(["spare"]);
    expect(pruned.content).not.toHaveProperty("spare");
    expect(pruned.content.faqs).toEqual([{ id: "1", question: "Q", answer: "A" }]);
    expect(mappedCollectionFields(source)).toContain("faqs");
  });
});
