/** Chrome the editor already knows. Anything else on a page is that page's body. */
const CHROME = new Set(["Topbar", "Header", "Breadcrumb", "Footer"]);

/**
 * Names from templateFlow `DEFAULT_MULTI_PAGES` and `getThemeManagerVisibility`.
 * The listing page id and its body section type have to be these, or the manager
 * does not attach. Detail routes (`services-id-detail`) stay as they are.
 */
const MANAGER_PAGES: { id: string; sectionType: string; ids: string[]; bodies: string[] }[] = [
  { id: "gallery", sectionType: "GalleryPage", ids: ["gallery", "galleries", "photo-gallery", "photos", "our-gallery", "image-gallery", "gallery-grid"], bodies: ["GalleryPage", "GalleryGrid", "GalleryAlbum", "Gallery"] },
  { id: "services", sectionType: "ServicePage", ids: ["service", "services", "our-services"], bodies: ["ServicePage", "ServiceGrid", "Services", "Service"] },
  { id: "events", sectionType: "EventPage", ids: ["event", "events", "our-events"], bodies: ["EventPage", "EventsPage", "EventGrid", "EventsGrid", "Events", "Event"] },
  { id: "properties", sectionType: "PropertyPage", ids: ["property", "properties"], bodies: ["PropertyPage", "PropertyGrid", "Property"] },
  { id: "portfolio", sectionType: "PortfolioPage", ids: ["portfolio", "portfolios", "project", "projects", "our-work"], bodies: ["PortfolioPage", "ProjectsPage", "ProjectGrid", "ProjectsGrid", "Portfolio", "Projects"] },
  { id: "teams", sectionType: "TeamPage", ids: ["team", "teams", "our-team", "our-teams"], bodies: ["TeamPage", "TeamGrid", "TeamsGrid", "Teams", "Team"] },
  { id: "blogs", sectionType: "BlogPage", ids: ["blog", "blogs", "news", "articles"], bodies: ["BlogPage", "BlogGrid", "BlogsGrid", "Blog"] },
  { id: "contact", sectionType: "ContactPage", ids: ["contact", "contact-us"], bodies: ["ContactPage", "Contact"] },
  { id: "countries", sectionType: "CountriesServe", ids: ["countries", "countries-we-serve"], bodies: ["CountriesServe", "Countries"] },
];

function managerRule(page: ThemePageInput) {
  if (page.id === "home" || page.id.endsWith("-detail")) return null;
  const byId = MANAGER_PAGES.find((rule) => rule.ids.includes(page.id));
  if (byId) return byId;
  const bodies = page.sections.filter((name) => !CHROME.has(name));
  if (bodies.length !== 1) return null;
  return MANAGER_PAGES.find((rule) => rule.bodies.includes(bodies[0])) ?? null;
}

export interface ThemePageInput {
  id: string;
  label: string;
  sectionType: string;
  sections: string[];
}

/**
 * Home is read only from `homeSectionOrder`. An inner page with an empty
 * `sections` array is rebuilt by the editor as Header + body + Footer, and
 * `AboutPage` also receives the shared Stats-5 and CTA-5.
 * Every name here is a `sectionVariants` key. The value is the component name.
 */
export function normalizeThemePages(pages: ThemePageInput[], sectionVariants: Record<string, string>): { homeSectionOrder: string[]; pages: ThemePageInput[] } {
  const known = (name: string) => Boolean(sectionVariants[name]);
  const claimed = new Set(pages.map((page) => page.id));
  const namedPages = pages.map((page) => {
    const rule = managerRule(page);
    if (!rule) return page;
    let next = page;
    if (rule.id !== page.id && !claimed.has(rule.id)) {
      claimed.delete(page.id);
      claimed.add(rule.id);
      next = { ...next, id: rule.id };
    }
    const body = rule.bodies.find((name) => next.sections.includes(name));
    if (!body) return next;
    // Opening the services manager deletes a section whose id is ServicePage
    // whenever the theme already has a Services section. Keep Services so that
    // listing stays. A separate service page then uses Service, which the
    // manager matches on page id "services" and does not delete.
    const sectionType =
      rule.id === "services" && (body === "Services" || sectionVariants.Services)
        ? body === "Services"
          ? "Services"
          : "Service"
        : rule.sectionType;
    if (!sectionVariants[sectionType] && sectionVariants[body]) {
      sectionVariants[sectionType] = sectionVariants[body];
    }
    if (!sectionVariants[sectionType]) return next;
    return {
      ...next,
      sectionType,
      sections: next.sections.map((name) => (name === body ? sectionType : name)),
    };
  });
  const home = namedPages.find((page) => page.id === "home");
  const homeSectionOrder = (home?.sections ?? []).filter(known);
  const out: ThemePageInput[] = [];

  for (const page of namedPages) {
    if (page.id === "home") {
      if (!homeSectionOrder.length) continue;
      out.push({ id: "home", label: page.label || "Home", sectionType: "Home", sections: [...homeSectionOrder] });
      continue;
    }
    // An empty list is what makes the editor invent Header + body + Footer (and Stats-5 / CTA-5 for AboutPage).
    if (!page.sections.length) continue;
    const bodies = page.sections.filter((name) => known(name) && !CHROME.has(name));
    const sections: string[] = [];
    if (known("Topbar")) sections.push("Topbar");
    if (known("Header")) sections.push("Header");
    if (known("Breadcrumb")) sections.push("Breadcrumb");
    for (const body of bodies) if (!sections.includes(body)) sections.push(body);
    if (known("Footer")) sections.push("Footer");
    if (!sections.length) continue;
    const sectionType = bodies.includes(page.sectionType) ? page.sectionType : bodies[0] || sections.find((name) => !CHROME.has(name)) || sections[0];
    out.push({ id: page.id, label: page.label, sectionType, sections });
  }
  return { homeSectionOrder, pages: out };
}
