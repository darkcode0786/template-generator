import { describe, expect, it } from "vitest";
import { extractTypeDeclarations, inlineTypesFromFile } from "@/lib/themeforge/inlineTypes";

const typesFile = `
import type { IconName } from "./icons";
export type SocialLink = { icon: IconName; url: string };
export interface HeaderProps {
  data: { menu?: SocialLink[]; logoText: string };
}
export interface Unused { title: string }
export function toSlug(value: string) { return value; }
`;

describe("inlineTypesFromFile", () => {
  it("copies the imported interface and the types it uses, and leaves functions behind", () => {
    const decls = extractTypeDeclarations(typesFile).map((d) => d.name);
    expect(decls).toEqual(["SocialLink", "HeaderProps", "Unused"]);
    const inlined = inlineTypesFromFile(typesFile, [{ imported: "HeaderProps", local: "HeaderProps" }], () => [
      { name: "IconName", text: "type IconName = string" },
    ]);
    expect(inlined.found).toEqual(["HeaderProps"]);
    expect(inlined.block).toContain("type IconName = string");
    expect(inlined.block).toContain("type SocialLink =");
    expect(inlined.block).toContain("interface HeaderProps {");
    expect(inlined.block.indexOf("type SocialLink")).toBeLessThan(inlined.block.indexOf("interface HeaderProps"));
    expect(inlined.block).not.toContain("Unused");
    expect(inlined.block).not.toContain("toSlug");
  });
});
