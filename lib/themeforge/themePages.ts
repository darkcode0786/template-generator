/** Chrome the editor already knows. Anything else on a page is that page's body. */
const CHROME = new Set(["Topbar", "Header", "Breadcrumb", "Footer"]);

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
  const home = pages.find((page) => page.id === "home");
  const homeSectionOrder = (home?.sections ?? []).filter(known);
  const out: ThemePageInput[] = [];

  for (const page of pages) {
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
