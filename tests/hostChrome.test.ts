import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  applyFooterSettings,
  applyHeaderSettings,
  applyPagerVisibility,
  collectFontFaces,
  linkTemplateFonts,
  normalizeSocialContent,
  resolveFontFaces,
  rewriteThemeUtilities,
  wrapSectionIcons,
  wrapSocialIcons,
} from "../lib/themeforge/hostChrome";
import { stabilizeListKeys } from "../lib/themeforge/themeIcons";

function syntaxErrors(code: string): string[] {
  const out = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020 }, fileName: "x.tsx" });
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("fonts", () => {
  const layout = `import { Cormorant_Garamond, Poppins } from "next/font/google";
const serif = Cormorant_Garamond({ subsets: ["latin"], variable: "--font-cormorant-face" });
const sans = Poppins({ weight: ["400"], variable: "--font-poppins-face" });`;

  it("resolves next/font variables to their family", () => {
    const faces = collectFontFaces([layout]);
    const vars = resolveFontFaces({ "--font-serif": "var(--font-cormorant-face, Georgia, serif)", "--font-sans": "var(--font-poppins-face, Arial, sans-serif)" }, faces);
    expect(vars["--font-serif"]).toBe('"Cormorant Garamond", Georgia, serif');
    expect(vars["--font-sans"]).toBe('"Poppins", Arial, sans-serif');
  });

  it("points template font tokens at the editor fonts", () => {
    const linked = linkTemplateFonts({ "--font-heading": "Cormorant Garamond, Georgia, serif", "--font-body": "Poppins, Arial, sans-serif", "--font-serif": '"Cormorant Garamond", Georgia, serif', "--font-sans": '"Poppins", Arial' });
    expect(linked["--font-serif"]).toBe("var(--font-heading)");
    expect(linked["--font-sans"]).toBe("var(--font-body)");
  });
});

describe("rewriteThemeUtilities", () => {
  it("maps @theme colour and font utilities to variables", () => {
    const code = `<p className="text-maroon hover:bg-maroon-dark border-line/40 font-serif font-bold text-primary">x</p>`;
    const out = rewriteThemeUtilities(code, { "--color-maroon": "#7a1f2b", "--color-maroon-dark": "#5a1520", "--color-line": "#ddd", "--color-primary": "#000", "--font-serif": "var(--font-heading)" });
    expect(out).toContain("text-[var(--color-maroon)]");
    expect(out).toContain("hover:bg-[var(--color-maroon-dark)]");
    expect(out).toContain("border-[color-mix(in_srgb,var(--color-line)_40%,transparent)]");
    expect(out).toContain("font-[family-name:var(--font-serif)]");
    expect(out).toContain("font-bold");
    expect(out).toContain("text-primary");
  });
});

describe("header and footer settings", () => {
  it("makes the header sticky by default and reads header colours", () => {
    const code = `export default function Header({ data }) {\n  return <header className="fixed top-0 w-full" style={{ height: 80 }}><nav /></header>;\n}\n`;
    const out = applyHeaderSettings(code);
    expect(out).toContain('data-tf-header-type={data?.headerType ?? "sticky"}');
    expect(out).toContain("ref={(node) => tfHeaderRef(node)}");
    expect(out).toContain('className="relative top-0 w-full"');
    expect(out).toContain('data-tf-overlay=""');
    expect(out).toContain('style={{ ...({ height: 80 }), ...tfChromeStyle(data, "header") }}');
    expect(syntaxErrors(out)).toEqual([]);
  });

  it("reads footer colours", () => {
    const out = applyFooterSettings(`export default function Footer({ data }) {\n  return <footer className="bg-ink">x</footer>;\n}\n`);
    expect(out).toContain('style={tfChromeStyle(data, "footer")}');
    expect(syntaxErrors(out)).toEqual([]);
  });
});

describe("icons", () => {
  it("social icons follow the platform dropdown", () => {
    const content = normalizeSocialContent({ socialLinks: [{ platform: "instagram", href: "#" }, { label: "Facebook", href: "#" }] });
    expect((content.socialLinks as { icon: string }[]).map((x) => x.icon)).toEqual(["instagram", "facebook"]);
    const code = `export default function Footer({ data }) {\n  return <div>{data.socialLinks.map((social) => {\n    const Icon = socialIcons[social.platform];\n    return <a key={social.platform} href={social.href}><Icon className="h-4 w-4" /></a>;\n  })}</div>;\n}\n`;
    const out = wrapSocialIcons(code);
    expect(out).toContain('{tfSocialIcon(social, <Icon className="h-4 w-4" />, "h-4 w-4")}');
    expect(out).toContain('from "../../../lib/socialPlatforms"');
    expect(syntaxErrors(out)).toEqual([]);
  });

  it("section icons keep the template glyph for template values", () => {
    const code = `export default function Services({ data }) {\n  return <div>{data.services.map((item) => (\n    <div key={item.title}>{iconMap[item.icon]}<h3>{item.title}</h3></div>\n  ))}</div>;\n}\n`;
    const out = wrapSectionIcons(code, { services: [{ icon: "gem", title: "A" }] }, "Services");
    expect(out).toContain('{tfIcon(item?.icon, iconMap[item.icon], "h-[1em] w-[1em]")}');
    expect(out).toContain('new Set<string>(["gem"])');
    expect(syntaxErrors(out)).toEqual([]);
  });
});

describe("list keys", () => {
  it("adds the index to every map key", () => {
    const out = stabilizeListKeys(`const a = items.map((item) => <li key={item.title}>{item.title}</li>);`);
    expect(out).toContain("items.map((item, index) => <li key={`${String(item.title ?? \"\")}-${index}`}>");
  });
});

describe("carousel pager", () => {
  it("tags prev/next buttons", () => {
    const code = `export default function T({ data }) {\n  return <section><button aria-label="Previous" onClick={prev}><ChevronLeft /></button><button onClick={next}><ChevronRight /></button><button>Book</button></section>;\n}\n`;
    const out = applyPagerVisibility(code);
    expect(out.match(/data-tf-pager=""/g)?.length).toBe(2);
    expect(syntaxErrors(out)).toEqual([]);
  });
});
