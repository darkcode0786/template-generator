import { describe, expect, it } from "vitest";
import { isDecorativeEditorField } from "@/lib/themeforge/transform";

describe("decorative editor fields", () => {
  const products = ["products", "title", "previousLabel", "previousIcon", "nextLabel", "nextIcon", "buttonText", "buttonIcon", "paginationLabel", "pageLabel", "productLabel"];

  it("hides arrow, pager, and quote controls", () => {
    for (const field of ["previousLabel", "previousIcon", "nextLabel", "nextIcon", "paginationLabel", "pageLabel", "slideLabel", "quoteIcon", "pagination"]) {
      expect(isDecorativeEditorField(field, [field, "title"])).toBe(true);
    }
  });

  it("hides the shared View Details control only on a carousel", () => {
    expect(isDecorativeEditorField("buttonText", products)).toBe(true);
    expect(isDecorativeEditorField("buttonIcon", products)).toBe(true);
    expect(isDecorativeEditorField("productLabel", products)).toBe(true);
    expect(isDecorativeEditorField("buttonText", ["title", "buttonText", "buttonUrl"])).toBe(false);
  });

  it("keeps the lists and headings visitors edit", () => {
    expect(isDecorativeEditorField("products", products)).toBe(false);
    expect(isDecorativeEditorField("title", products)).toBe(false);
    expect(isDecorativeEditorField("testimonials", ["testimonials", "quoteIcon", "slideLabel"])).toBe(false);
  });
});
