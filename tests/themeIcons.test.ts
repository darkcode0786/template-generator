import { describe, expect, it } from "vitest";
import { hoistUseClient, rewriteDynamicIcons, rewritePreviewHrefs, stabilizeListKeys } from "@/lib/themeforge/themeIcons";

describe("rewriteDynamicIcons", () => {
  it("renders whatever icon the editor dropdown stores", () => {
    const code = rewriteDynamicIcons(`"use client";
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
`);
    expect(code).toContain('const renderIcon = (iconName?: string) => <WebsiteIcon name={String(iconName ?? "")} />;');
    expect(code).toContain('WebsiteIcon name={String(feature.icon ?? "")}');
    expect(code).toContain('WebsiteIcon name={String(feat.icon ?? "")}');
    expect(code).not.toContain("FaGlobe");
    expect(code).toContain('import { WebsiteIcon } from "../../../lib/websiteIcons";');
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
});

describe("stabilizeListKeys", () => {
  it("gives a list a key when the item id is missing", () => {
    const code = stabilizeListKeys(`{data.menu?.map((link) => {
      return <a key={link.id} href={link.url}>{link.label}</a>;
    })}
    {items.map((item, i) => <b key={item.id}>{item.title}</b>)}
    {rows.map(row => (<i key={row.id} />))}`);
    expect(code).toContain("data.menu?.map((link, index) =>");
    expect(code).toContain("key={link.id ?? index}");
    expect(code).toContain("key={item.id ?? i}");
    expect(code).toContain("rows.map((row, index) =>");
    expect(code).toContain("key={row.id ?? index}");
  });
});
