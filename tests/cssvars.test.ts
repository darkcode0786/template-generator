import { describe, expect, it } from "vitest";
import { buildThemeVariables, cssVarsInjector, extractCssVariables, mergeCssVariables, rewriteThemeHexes, serializeRootVars, THEME_VARIABLE_KEYS } from "@/lib/themeforge/cssvars";
import { blockifyArrowBody, findComponentBody } from "@/lib/themeforge/transform";

describe("extractCssVariables", () => {
  it("reads :root custom properties and ignores comments and normal declarations", () => {
    const css = `
@tailwind base;
:root {
  /* Fonts */
  --font-primary: var(--font-poppins), sans-serif;
  --color-primary: #031b33;
  color: red;
  --color-accent:   #0d6efd ;
}
body { color: var(--color-primary); --not-root: 1; }
`;
    expect(extractCssVariables(css)).toEqual({
      "--font-primary": "var(--font-poppins), sans-serif",
      "--color-primary": "#031b33",
      "--color-accent": "#0d6efd",
    });
  });

  it("supports Tailwind v4 @theme blocks and skips nested blocks", () => {
    const css = `@import "tailwindcss";\n@theme inline {\n  --color-brand: oklch(0.6 0.2 250);\n  @media (prefers-color-scheme: dark) { --color-brand: black; }\n  --radius-lg: 12px;\n}`;
    expect(extractCssVariables(css)).toEqual({ "--color-brand": "oklch(0.6 0.2 250)", "--radius-lg": "12px" });
  });

  it("keeps the first definition when merging several sheets", () => {
    const merged = mergeCssVariables([":root{--a:1;--b:2}", ":root{--a:9;--c:3}"]);
    expect(merged).toEqual({ "--a": "1", "--b": "2", "--c": "3" });
  });

  it("serialises to the reference :root{...} format and a self-guarding IIFE", () => {
    const vars = { "--color-primary": "#0a1828", "--color-accent": "#c49250" };
    expect(serializeRootVars(vars)).toBe(":root{--color-primary:#0a1828;--color-accent:#c49250;}");
    const js = cssVarsInjector(vars);
    expect(js).toBe(
      '(() => { if (typeof document === "undefined") return; if (document.getElementById("theme-upload-css-vars")) return; const s = document.createElement("style"); s.id = "theme-upload-css-vars"; s.textContent = ":root{--color-primary:#0a1828;--color-accent:#c49250;}"; document.head.appendChild(s); })();',
    );
    // must be valid JS
    expect(() => new Function(js)).not.toThrow();
  });
});

describe("buildThemeVariables", () => {
  it("uses a saturated accent as Primary and a dark navy as the hero", () => {
    const built = buildThemeVariables({
      "--color-primary": "#0a1828",
      "--color-accent": "#c49250",
      "--color-bg-main": "#ffffff",
      "--color-text": "#333333",
      "--font-heading": "Playfair Display, Georgia, serif",
      "--font-body": "Inter, system-ui, sans-serif",
    });
    expect(Object.keys(built.variables)).toEqual([...THEME_VARIABLE_KEYS]);
    expect(built.variables["--primary-bg"]).toBe("#c49250");
    expect(built.variables["--primary-text"]).toBe("#ffffff");
    expect(built.variables["--hero-bg"]).toBe("#0a1828");
    expect(built.variables["--secondary-bg"]).toBe("#ffffff");
    expect(built.variables["--secondary-text"]).toBe("#333333");
    expect(built.variables["--blue-bg"]).toBe("#c49250");
    expect(built.variables["--font-heading"]).toBe("Playfair Display, Georgia, serif");
    expect(built.variables["--font-body"]).toBe("Inter, system-ui, sans-serif");
    expect(built.injected["--color-brand"]).toBe("var(--primary-bg)");
    expect(built.injected["--color-primary"]).toBe("var(--primary-bg)");
  });

  it("keeps a mid-tone brand primary when that is the theme's only colour", () => {
    const built = buildThemeVariables({ "--color-primary": "#0d6efd" });
    expect(built.variables["--primary-bg"]).toBe("#0d6efd");
    expect(built.variables["--primary-link-bg"]).toBe("#0d6efd");
    expect(built.variables["--font-body"]).toBe("Poppins, system-ui, sans-serif");
  });

  it("reads the brand hex from component classes when the stylesheet has no variables", () => {
    const built = buildThemeVariables({}, `className="bg-[#1B8A3E] text-[#1B8A3E] bg-[#06243b]"`);
    expect(built.variables["--primary-bg"]).toBe("#1b8a3e");
    expect(built.variables["--hero-bg"]).toBe("#06243b");
    expect(rewriteThemeHexes(`<div className="bg-[#1B8A3E] hover:text-[#06243b]" />`, built.rewrites)).toBe(
      `<div className="bg-[var(--color-primary)] hover:text-[var(--color-heading)]" />`,
    );
  });
});

describe("findComponentBody", () => {
  it("handles function declarations, arrow consts with type annotations and memo wrappers", () => {
    const cases: [string, string][] = [
      ["export default function Hero({ data }: { data?: Record<string, any> }) {\n  return null;\n}", "{ data }: { data?: Record<string, any> }"],
      ["export const Hero = ({ data }: Props): JSX.Element => {\n  return <div/>;\n}", "{ data }: Props"],
      ["const Hero: React.FC<Props> = ({ data }) => {\n  return <div/>;\n}", "{ data }"],
      ["const Hero = React.memo(({ data }: Props) => {\n  return <div/>;\n})", "{ data }: Props"],
      ["function Hero(props: { data: Data }) {\n  return null;\n}", "props: { data: Data }"],
    ];
    for (const [code, params] of cases) {
      const body = findComponentBody(code, "Hero");
      expect(body, code).not.toBeNull();
      expect(body!.params, code).toBe(params);
      expect(code.slice(body!.bodyStart).trimStart().startsWith("return"), code).toBe(true);
    }
  });

  it("returns null for expression-bodied arrows and unknown names", () => {
    expect(findComponentBody("const Hero = ({ data }: Props) => <div>{data.title}</div>;", "Hero")).toBeNull();
    expect(findComponentBody("function Other() { return null; }", "Hero")).toBeNull();
  });
});

describe("blockifyArrowBody", () => {
  it("turns an expression-bodied arrow into a block with return", () => {
    const src = "export const Crumb = ({ data }: { data?: any }) => <nav title=\"a;b\">{data?.title}</nav>;\nexport default Crumb;\n";
    const out = blockifyArrowBody(src, "Crumb");
    expect(out).toBe("export const Crumb = ({ data }: { data?: any }) => {\n  return (<nav title=\"a;b\">{data?.title}</nav>);\n};\nexport default Crumb;\n");
    expect(findComponentBody(out, "Crumb")).not.toBeNull();
  });

  it("handles parenthesised multi-line JSX and memo wrappers; leaves block bodies alone", () => {
    const multi = "const Hero = ({ data }) => (\n  <section>\n    <h1>{data.title}</h1>\n  </section>\n);\n";
    expect(blockifyArrowBody(multi, "Hero")).toBe("const Hero = ({ data }) => {\n  return ((\n  <section>\n    <h1>{data.title}</h1>\n  </section>\n));\n};\n");
    const memo = "const Hero = React.memo(({ data }) => <b>{data.x}</b>);";
    expect(blockifyArrowBody(memo, "Hero")).toBe("const Hero = React.memo(({ data }) => {\n  return (<b>{data.x}</b>);\n});");
    const block = "const Hero = ({ data }) => {\n  return null;\n};";
    expect(blockifyArrowBody(block, "Hero")).toBe(block);
    expect(blockifyArrowBody("function Hero() { return null; }", "Hero")).toBe("function Hero() { return null; }");
  });
});
