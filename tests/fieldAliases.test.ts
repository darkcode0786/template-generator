import { describe, expect, it } from "vitest";
import { applyFieldAliases, braceGroups, toCamelCase, type FieldAliasConfig } from "@/lib/themeforge/fieldAliases";
import { loadBundledSpec } from "./helpers";

const cfg: FieldAliasConfig = {
  enabled: true,
  camelCase: true,
  fields: { titleLine1: "title", img: "image", faqs: "faqItems", btn: "button", bg: "backgroundImage" },
  bySectionType: { Gallery: { items: "galleryItems" }, Stats: { items: "stats" } },
};

describe("toCamelCase", () => {
  it("converts snake and kebab case, leaves camelCase alone", () => {
    expect(toCamelCase("title_line1")).toBe("titleLine1");
    expect(toCamelCase("video-button_link")).toBe("videoButtonLink");
    expect(toCamelCase("titleHighlight")).toBe("titleHighlight");
    expect(toCamelCase("_private")).toBe("private");
  });
});

describe("braceGroups", () => {
  it("tells object/destructuring braces apart from blocks and JSX expression containers", () => {
    const code = `const { a } = data; function f() { return { b: 1 }; } const x = <p title={a}>{a}</p>; const y = cond ? { c } : null;`;
    const groups = braceGroups(code).sort((a, b) => a.open - b.open);
    const text = (g: { open: number; close: number }) => code.slice(g.open, g.close + 1);
    const objects = groups.filter((g) => g.isObject).map(text);
    const blocks = groups.filter((g) => !g.isObject).map(text);
    expect(objects).toEqual(["{ a }", "{ b: 1 }", "{ c }"]);
    expect(blocks).toEqual(["{ return { b: 1 }; }", "{a}", "{a}"]);
  });
});

describe("applyFieldAliases", () => {
  const code = `'use client';
type Props = { data?: { title_line1?: string; items?: { img: string; title_line1: string }[] } };
export default function Gallery({ data }: Props) {
  const { title_line1, faqs = [] } = data ?? {};
  const bg = data?.bg;
  const sub = data["sub_title"];
  return (
    <section style={{ backgroundImage: \`url(\${bg})\` }}>
      <h2>{title_line1}</h2>
      <p title={title_line1}>{data.btn?.text}</p>
      {data.items?.map(({ img, title_line1 }) => <img key={img} src={img} alt={title_line1} />)}
      {faqs.map((f) => <b>{f.question}</b>)}
      <Child data={{ title_line1, nested: { items: [] } }} />
    </section>
  );
}`;
  const content = {
    title_line1: "Hello",
    sub_title: "Sub",
    bg: "/bg.jpg",
    btn: { text: "Go" },
    faqs: [{ question: "Q?" }],
    items: [{ img: "/a.jpg", title_line1: "A" }],
  };
  const fields = ["title_line1", "sub_title", "bg", "btn", "faqs", "items"];
  const r = applyFieldAliases(code, content, fields, "Gallery", cfg);

  it("renames content keys at every depth and the editorFields", () => {
    expect(r.content).toEqual({
      title: "Hello",
      subTitle: "Sub",
      backgroundImage: "/bg.jpg",
      button: { text: "Go" },
      faqItems: [{ question: "Q?" }],
      galleryItems: [{ image: "/a.jpg", title: "A" }],
    });
    expect(r.editorFields).toEqual(["title", "subTitle", "backgroundImage", "button", "faqItems", "galleryItems"]);
  });

  it("rewrites property access, bracket access, destructuring (keeping local names) and type literals", () => {
    expect(r.code).toContain("const { title: title_line1, faqItems: faqs = [] } = data ?? {};");
    expect(r.code).toContain("const bg = data?.backgroundImage;");
    expect(r.code).toContain('data["subTitle"]');
    expect(r.code).toContain("data.button?.text");
    expect(r.code).toContain("data.galleryItems?.map(({ image: img, title: title_line1 }) =>");
    expect(r.code).toContain("type Props = { data?: { title?: string; galleryItems?: { image: string; title: string }[] } };");
    // object literal passed to a child: key renamed, value expression untouched
    expect(r.code).toContain("<Child data={{ title: title_line1, nested: { galleryItems: [] } }} />");
  });

  it("never touches local variables rendered in JSX or used as attribute values", () => {
    expect(r.code).toContain("<h2>{title_line1}</h2>");
    expect(r.code).toContain("<p title={title_line1}>");
    expect(r.code).toContain("key={img} src={img} alt={title_line1}");
    expect(r.code).toContain("url(${bg})");
    expect(r.code).toContain("faqs.map((f) =>");
  });

  it("composes camelCase with the alias map but refuses chained or colliding renames", () => {
    // title_line1 -> titleLine1 (camelCase) -> title (alias table) in one hop; true chains between existing keys are refused
    expect(r.renamed.map((x) => `${x.from}→${x.to}`)).toEqual(expect.arrayContaining(["title_line1→title", "bg→backgroundImage", "items→galleryItems"]));
    const r2 = applyFieldAliases("x", { title: "T", titleLine1: "L", img: "/a", image: "/b" }, ["title", "titleLine1", "img", "image"], "About", cfg);
    expect(r2.content).toEqual({ title: "T", titleLine1: "L", img: "/a", image: "/b" });
    expect(r2.skipped.map((s) => s.key).sort()).toEqual(["img", "titleLine1"]);
  });

  it("applies section renames only to top-level-only keys and checks value kinds", () => {
    const nested = applyFieldAliases("x", { items: [{ a: 1 }], sidebar: { items: ["x"] } }, ["items", "sidebar"], "Gallery", cfg);
    expect(Object.keys(nested.content)).toEqual(["items", "sidebar"]);
    expect(nested.skipped[0]).toMatchObject({ key: "items", to: "galleryItems" });
    const wrongKind = applyFieldAliases("x", { bg: { url: "/x" } }, ["bg"], "About", cfg);
    expect(wrongKind.content).toEqual({ bg: { url: "/x" } });
    expect(wrongKind.skipped[0].reason).toMatch(/expects a string/);
  });

  it("is a no-op when disabled", () => {
    const off = applyFieldAliases(code, content, fields, "Gallery", { ...cfg, enabled: false });
    expect(off.code).toBe(code);
    expect(off.content).toBe(content);
  });

  it("does not rename a collection onto a popup schema that would hide item fields", () => {
    const faq = applyFieldAliases("x", { faqs: [{ title: "Q", description: "A" }] }, ["faqs"], "FAQ", cfg);
    expect(faq.content).toEqual({ faqs: [{ title: "Q", description: "A" }] });
    expect(faq.skipped[0]?.reason).toMatch(/hides/);
    const questions = applyFieldAliases("x", { faqs: [{ question: "Q", answer: "A" }] }, ["faqs"], "FAQ", cfg);
    expect(questions.content).toEqual({ faqItems: [{ question: "Q", answer: "A" }] });
  });

  it("bundled spec ships the host vocabulary", async () => {
    const spec = await loadBundledSpec();
    const a = spec.transformations.hostFieldAliases;
    expect(a.enabled).toBe(true);
    expect(a.fields.img).toBe("image");
    expect(a.fields.faqs).toBe("faqItems");
    expect(a.bySectionType.Gallery.items).toBe("galleryItems");
    expect(a.bySectionType.WhyChooseUs.features).toBe("whyChooseUsItems");
  });
});
