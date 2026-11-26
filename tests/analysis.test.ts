import { describe, expect, it } from "vitest";
import { extractDataFields, extractDeclaredPageOrder, findDefaultContent, inferFieldShapes, mappedSectionOrder, orderByDeclaredRoutes, primaryJsxUsageOrder, readsJsonSection, seedValueFor } from "@/lib/themeforge/analysis";
import { adoptJsonContent } from "@/lib/themeforge/transform";

const data = [
  {
    path: "components/data/data.json",
    json: {
      common: { Header: { logo: "/logo.webp", menu: [{ label: "Home", url: "/" }] } },
      categories: {
        Electrical: {
          sections: {
            about: { title: "About", subtitle: "x", description: "y", badge: "b", overlay_line1: "o" },
            service_details: [
              { slug: "wiring", title: "Wiring", subtitle: "s", description: "d", badge: "b", overlay_line1: "o", overlay_highlight: "h", content_blocks: [] },
              { slug: "repair", title: "Repair" },
            ],
          },
        },
      },
    },
  },
];

describe("inferFieldShapes / seedValueFor", () => {
  const src = `
export default function About({ data }: { data?: any }) {
  const { count, label } = data.stats;
  return (
    <section>
      <span>{data?.badge?.value} {data.badge.label}</span>
      {data?.cards?.map((card, i) => (
        <div key={card.id}><h3>{card.title}</h3><p>{card?.description}</p><Icon name={card.icon} /></div>
      ))}
      {data.features.slice(0, 3).map(({ title, desc }) => <li>{title} {desc}</li>)}
      {data.tags?.map((t) => <b>{t}</b>)}
      <a href={data.button.href}>{data.button.text}</a>
      <p>{data.description}</p>
    </section>
  );
}`;
  const fields = ["stats", "badge", "cards", "features", "tags", "button", "description"];
  const shapes = inferFieldShapes(src, fields);

  it("collects object sub-keys from member access and destructuring", () => {
    expect(shapes.badge).toEqual({ kind: "object", keys: ["value", "label"], itemKeys: [] });
    expect(shapes.stats).toEqual({ kind: "object", keys: ["count", "label"], itemKeys: [] });
    expect(shapes.button.keys).toEqual(["href", "text"]);
  });

  it("collects array item keys from map callbacks (identifier and destructured) and through slice()", () => {
    expect(shapes.cards.kind).toBe("array");
    expect(shapes.cards.itemKeys).toEqual(["id", "title", "description", "icon"]);
    expect(shapes.features.itemKeys).toEqual(["title", "desc"]);
    expect(shapes.tags).toEqual({ kind: "array", keys: [], itemKeys: [] });
    expect(shapes.description).toEqual({ kind: "string", keys: [], itemKeys: [] });
  });

  it("understands the `|| []` / `?? {}` fallback idioms", () => {
    const s = inferFieldShapes(
      `const all = [...(data.navLeft || []), ...(data.navRight ?? [])];
       const meta = data.meta || {};
       {(data.benefits || []).slice(0, 4).map((b) => <li>{b.title} {b.icon}</li>)}`,
      ["navLeft", "navRight", "meta", "benefits"],
    );
    expect(s.navLeft.kind).toBe("array");
    expect(s.navRight.kind).toBe("array");
    expect(s.meta.kind).toBe("object");
    expect(s.benefits).toEqual({ kind: "array", keys: [], itemKeys: ["title", "icon"] });
  });

  it("seeds blank values in that shape so the host editor can render and add items", () => {
    expect(seedValueFor(shapes.badge)).toEqual({ value: "", label: "" });
    expect(seedValueFor(shapes.cards)).toEqual([{ id: "item-1", title: "", description: "", icon: "" }]);
    expect(seedValueFor(shapes.tags)).toEqual([]);
    expect(seedValueFor(shapes.description)).toBe("");
  });
});

describe("primaryJsxUsageOrder", () => {
  const names = ["TopBar", "Header", "Breadcrumb", "Footer", "BlogDetail"];

  it("uses the successful return when an earlier branch renders Footer first", () => {
    const source = `
export default function Page() {
  if (!current) {
    return (
      <main>
        <TopBar />
        <Header />
        <Footer />
      </main>
    );
  }
  return (
    <main>
      <TopBar />
      <Header />
      <Breadcrumb />
      <BlogDetail />
      <Footer />
    </main>
  );
}`;
    expect(primaryJsxUsageOrder(source, names)).toEqual(["TopBar", "Header", "Breadcrumb", "BlogDetail", "Footer"]);
  });

  it("keeps Footer when a nested callback also returns JSX", () => {
    const source = `
export default function Page() {
  return (
    <main>
      <Header />
      {items.map((item) => { return <span>{item}</span>; })}
      <Footer />
    </main>
  );
}`;
    expect(primaryJsxUsageOrder(source, ["Header", "Footer"])).toEqual(["Header", "Footer"]);
  });

  it("reads sections that a page picks from a lookup map", () => {
    const source = `export default function Home() {
      const sectionMap = {
        Hero: sections.hero ? <Hero data={sections.hero} /> : null,
        About: sections.about ? <About data={sections.about} /> : null,
        Faq: sections.faq ? <Faq data={sections.faq} /> : null,
      };
      return <div><Header data={common.Header} />{pageData.components.map((block) => sectionMap[block.component])}<Footer data={common.Footer} /></div>;
    }`;
    expect(mappedSectionOrder(source, ["Header", "Hero", "About", "Faq", "Footer"])).toEqual(["Hero", "About", "Faq"]);
  });
});

describe("page order from the repository", () => {
  const sitemap = `
const pages = [
  { name: globalUI?.sitemapHome || 'Home', url: '/' },
  { name: globalUI?.sitemapAbout || 'About Us', url: '/about' },
  { name: globalUI?.sitemapWhyChooseUs || 'Why Choose Us', url: '/why-choose-us' },
  { name: 'Services', url: '/services' },
];
items.forEach((service) => {
  pages.push({ name: 'Service Detail', url: \`/services/\${service.slug}\` });
});
items.forEach((industry) => {
  pages.push({ name: \`\${industry.title} Detail\`, url: \`/industries/\${industry.slug}\` });
});
pages.push({ name: 'Our Team', url: '/team' });
pages.push({ name: 'Blog', url: '/blogs' });
`;
  const known = ["/", "/about", "/why-choose-us", "/services", "/services/[id]", "/industries/[id]", "/team", "/blogs", "/blogs/[id]", "/legal-updates"];

  it("reads sitemap urls, template detail routes, and fallback labels in source order", () => {
    const declared = extractDeclaredPageOrder(sitemap, known);
    expect(declared.map((d) => d.route)).toEqual(["/", "/about", "/why-choose-us", "/services", "/services/[id]", "/industries/[id]", "/team", "/blogs"]);
    expect(declared.find((d) => d.route === "/about")?.label).toBe("About Us");
    expect(declared.find((d) => d.route === "/why-choose-us")?.label).toBe("Why Choose Us");
    expect(declared.find((d) => d.route === "/services/[id]")?.label).toBe("Service Detail");
    expect(declared.find((d) => d.route === "/industries/[id]")?.label).toBeUndefined();
  });

  it("places undeclared detail routes after their parent and leaves the rest at the end", () => {
    const pages = known.map((route) => ({
      id: route === "/" ? "home" : route.replace(/^\//, "").replace(/\[id\]/g, "id-detail").replace(/\//g, "-"),
      route,
      label: route,
    }));
    const ordered = orderByDeclaredRoutes(pages, extractDeclaredPageOrder(sitemap, known));
    expect(ordered.map((p) => p.route)).toEqual(["/", "/about", "/why-choose-us", "/services", "/services/[id]", "/industries/[id]", "/team", "/blogs", "/blogs/[id]", "/legal-updates"]);
    expect(ordered.find((p) => p.route === "/team")?.label).toBe("Our Team");
  });
});

describe("findDefaultContent", () => {
  it("uses the first entry of a list of records when it covers the component's fields best", () => {
    const fields = ["title", "subtitle", "description", "badge", "overlay_line1", "overlay_highlight", "content_blocks", "benefits"];
    const m = findDefaultContent(data, "ServiceDetails", ["ServiceDetails"], fields);
    expect(m?.source).toBe("components/data/data.json#categories.Electrical.sections.service_details[0]");
    expect(m?.value).toMatchObject({ slug: "wiring", title: "Wiring" });
  });

  it("still prefers a dedicated object over a list entry with equal coverage", () => {
    const m = findDefaultContent(data, "About", ["About"], ["title", "subtitle", "description"]);
    expect(m?.source).toBe("components/data/data.json#categories.Electrical.sections.about");
  });

  it("does not treat an array nested inside matched content as a separate component", () => {
    const m = findDefaultContent(data, "Header", ["Header"], ["logo", "menu"]);
    expect(m?.source).toBe("components/data/data.json#common.Header");
    expect(findDefaultContent(data, "Menu", ["Menu"], ["label", "url"])?.source).toBe("components/data/data.json#common.Header.menu[0]");
  });
});

describe("extractDataFields", () => {
  it("follows the order fields appear in the component", () => {
    const source = `export const Header = ({ data }: { data?: any }) => {
      const { logo, menu } = data ?? {};
      return <header>{data?.topbar}{logo}{menu?.length}{data["contactButton"]}</header>;
    };`;
    expect(extractDataFields(source)).toEqual(["logo", "menu", "topbar", "contactButton"]);
  });

  it("reads fields from a renamed data prop", () => {
    const source = `export default function HeroSection({ data: hero = site.hero }: { data?: any }) {
      return <section><p>{hero.label}</p><h1>{hero.titleLines.map((line) => line.text)}</h1><a href={hero.button.href}>{hero.button.label}</a></section>;
    }`;
    expect(extractDataFields(source)).toEqual(["label", "titleLines", "button"]);
  });
});

describe("json section content", () => {
  const source = `import websiteData from "../data/websiteData.json";
export default function Hero() {
  const heroData = websiteData.categories.TalentBridge.sections.Hero.variants.TBHero1;
  return <h1>{heroData.titleLine1}</h1>;
}`;

  it("keeps a section that reads a JSON file instead of data", () => {
    expect(readsJsonSection(source)).toBe(true);
    expect(extractDataFields(source)).toEqual([]);
  });

  it("rewrites that JSON binding into the data prop", () => {
    const code = adoptJsonContent(source, "Hero", "Hero");
    expect(code).not.toContain("websiteData");
    expect(code).toContain("function Hero({ data = {} }");
    expect(code).toContain("data.titleLine1");
    expect(extractDataFields(code)).toEqual(["titleLine1"]);
  });
});
