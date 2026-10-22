/**
 * Menu urls have to land on the page id stored in theme.json.
 * `/team` and `/photo-gallery` would open a hash the editor does not have
 * after those routes are saved as `teams` and `gallery`.
 */
const CANONICAL_PAGE: Record<string, string> = {
  galleries: "gallery",
  "photo-gallery": "gallery",
  photos: "gallery",
  "our-gallery": "gallery",
  "image-gallery": "gallery",
  "gallery-grid": "gallery",
  service: "services",
  "our-services": "services",
  event: "events",
  "our-events": "events",
  property: "properties",
  portfolios: "portfolio",
  project: "portfolio",
  projects: "portfolio",
  "our-work": "portfolio",
  team: "teams",
  "our-team": "teams",
  "our-teams": "teams",
  blog: "blogs",
  news: "blogs",
  articles: "blogs",
  "contact-us": "contact",
  "countries-we-serve": "countries",
};

export function rewriteInternalNavPaths(source: string, pageIds: Iterable<string>): string {
  const ids = new Set([...pageIds].map((id) => id.trim().toLowerCase()).filter(Boolean));
  return source.replace(/(["'`])(\/(?!\/)[A-Za-z0-9][A-Za-z0-9-]*)\1/g, (full, quote: string, path: string) => {
    const slug = path.slice(1).toLowerCase();
    if (ids.has(slug)) return full;
    const canonical = CANONICAL_PAGE[slug];
    if (!canonical || !ids.has(canonical)) return full;
    return `${quote}/${canonical}${quote}`;
  });
}
