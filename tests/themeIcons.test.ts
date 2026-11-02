import { describe, expect, it } from "vitest";
import { bindPreviewNavClicks, hoistUseClient, rewriteDynamicIcons, rewriteHeaderNavHrefs, rewritePreviewHrefs, stabilizeListKeys } from "@/lib/themeforge/themeIcons";

describe("rewriteDynamicIcons", () => {
  it("keeps the icons the template already draws", () => {
    const source = `"use client";
const renderIcon = (iconName?: string) => {
  switch (iconName) {
    case "FaStar": return <FaStar />;
    default: return <FaStar />;
  }
};
const Icon = IconMap[feature.icon] || FaRegUser;
<div>
  {feat.icon === "star" && <FaStar />}
  {feat.icon === "globe" && <FaGlobe />}
</div>
`;
    const code = rewriteDynamicIcons(source);
    expect(code).toBe(source);
    expect(code).toContain("<FaStar />");
    expect(code).toContain("<FaGlobe />");
    expect(code).not.toContain("WebsiteIcon");
  });
});

describe("rewritePreviewHrefs", () => {
  it("sends header links through the editor page hash", () => {
    const code = rewritePreviewHrefs(`import Link from "next/link";
export default function Header() {
  return <Link href={link.url}> <a href="/contact">Contact</a></Link>;
}
`);
    expect(code).not.toContain("next/link");
    expect(code).toContain("href={toLestowHref(link.url)}");
    expect(code).toContain('href={toLestowHref("/contact")}');
    expect(code).toContain('import { toLestowHref } from "../../../lib/lexoraPreview";');
    expect(rewritePreviewHrefs(code).match(/toLestowHref\(link\.url\)/g)?.length).toBe(1);
  });

  it("reads url or href on each header nav item", () => {
    const code = rewriteHeaderNavHrefs(rewritePreviewHrefs(`export const Header = ({ data }) => (
  <nav>
    {data.menu.map((link) => (
      <a href={link.url}>
        {link.label}
        {link.subLinks?.map((drop) => (
          <a href={drop.href}>{drop.label}</a>
        ))}
      </a>
    ))}
    {data.menu.map((item) => {
      return <a href={item.href}>{item.label}</a>;
    })}
  </nav>
));`));
    expect(code).toContain("const linkHref = link.url || link.href;");
    expect(code).toContain("href={toLestowHref(linkHref)}");
    expect(code).toContain("const dropHref = drop.url || drop.href;");
    expect(code).toContain("href={toLestowHref(dropHref)}");
    expect(code).toContain("const itemHref = item.url || item.href;");
    expect(code).toContain("href={toLestowHref(itemHref)}");
    expect(code).not.toContain("href={toLestowHref(link.url)}");
    expect(code).not.toContain("href={toLestowHref(drop.href)}");
    expect(rewriteHeaderNavHrefs(code).match(/const linkHref/g)?.length).toBe(1);
  });

  it("keeps use client above the preview import", () => {
    const code = rewritePreviewHrefs(`import React from "react";

'use client';
export default function Footer() {
  return <a href={link.url}>Go</a>;
}
`);
    expect(hoistUseClient(code).startsWith("'use client';\nimport { toLestowHref }")).toBe(true);
    expect(hoistUseClient(code).indexOf("'use client'")).toBeLessThan(hoistUseClient(code).indexOf("import"));
  });

  it("switches the editor page when a header link is clicked", () => {
    const code = bindPreviewNavClicks(rewriteHeaderNavHrefs(rewritePreviewHrefs(`export const Header = ({ data }: { data?: any }) => {
  return (
    <nav>
      {data.menu.map((link) => (
        <a href={link.url}>{link.label}</a>
      ))}
    </nav>
  );
};`)));
    expect(code).toContain("const previewNav = usePreview();");
    expect(code).toContain('import { usePreview } from "../../context/PreviewContext";');
    expect(code).toContain('import { handlePreviewMenuNavigate } from "../../../lib/sectionScroll";');
    expect(code).toContain("event.preventDefault();");
    expect(code).toContain("previewNav.setCurrentPage");
    expect(code).toContain("href={toLestowHref(linkHref)}");
  });
});

describe("stabilizeListKeys", () => {
  it("gives a list a key when the item id is missing", () => {
    const code = stabilizeListKeys(`{data.menu?.map((link) => {
      return <a key={link.id} href={link.url}>{link.label}</a>;
    })}
    {items.map((item, i) => <b key={item.id}>{item.title}</b>)}
    {rows.map(row => (<i key={row.id} />))}`);
    expect(code).toContain("data.menu?.map((link, index) =>");
    expect(code).toContain('key={`${String(link.id ?? "")}-${index}`}');
    expect(code).toContain('key={`${String(item.id ?? "")}-${i}`}');
    expect(code).toContain("rows.map((row, index) =>");
    expect(code).toContain('key={`${String(row.id ?? "")}-${index}`}');
  });
});
