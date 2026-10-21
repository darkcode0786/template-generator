import { parseImports, resolveImport, type AliasConfig, type ParsedImport } from "./analysis";

export interface TypeDecl {
  name: string;
  text: string;
}

function skipString(source: string, i: number): number {
  const q = source[i];
  i += 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (q === "`" && source[i] === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        const c = source[i];
        if (c === '"' || c === "'" || c === "`") {
          i = skipString(source, i);
          continue;
        }
        if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    if (source[i] === q) return i + 1;
    i += 1;
  }
  return source.length;
}

function matchBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i) - 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** End index (exclusive) of a type alias that starts after its name. */
function endOfTypeAlias(source: string, i: number): number {
  let angle = 0;
  let brace = 0;
  let paren = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i);
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      const n = source.indexOf("\n", i);
      i = n < 0 ? source.length : n + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const n = source.indexOf("*/", i + 2);
      i = n < 0 ? source.length : n + 2;
      continue;
    }
    if (c === "<") angle += 1;
    else if (c === ">") angle = Math.max(0, angle - 1);
    else if (c === "{") brace += 1;
    else if (c === "}") brace = Math.max(0, brace - 1);
    else if (c === "(") paren += 1;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if (c === ";" && angle === 0 && brace === 0 && paren === 0) return i + 1;
    else if (c === "\n" && angle === 0 && brace === 0 && paren === 0) {
      if (/^\s*(?:export|interface|type|function|const|class|import|enum)\b/.test(source.slice(i + 1))) return i;
    }
    i += 1;
  }
  return source.length;
}

function stripExport(text: string): string {
  return text.replace(/^\s*(?:export\s+)?(?:declare\s+)?/, "").trim();
}

/** Top-level `interface` / `type` declarations in a TypeScript file. */
export function extractTypeDeclarations(source: string): TypeDecl[] {
  const decls: TypeDecl[] = [];
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const n = source.indexOf("\n", i);
      i = n < 0 ? source.length : n + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const n = source.indexOf("*/", i + 2);
      i = n < 0 ? source.length : n + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i);
      continue;
    }
    if (c === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "}") {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth === 0) {
      const m = /^(?:export\s+)?(?:declare\s+)?(interface|type)\s+([A-Za-z_$][\w$]*)\b/.exec(source.slice(i));
      const boundary = i === 0 || /[\s;}]/.test(source[i - 1]);
      if (m && boundary) {
        const kind = m[1];
        const name = m[2];
        if (kind === "interface") {
          const brace = source.indexOf("{", i + m[0].length);
          const end = brace >= 0 ? matchBrace(source, brace) : -1;
          if (end >= 0) {
            decls.push({ name, text: stripExport(source.slice(i, end + 1)) });
            i = end + 1;
            continue;
          }
        } else {
          const end = endOfTypeAlias(source, i + m[0].length);
          const text = stripExport(source.slice(i, end)).replace(/;\s*$/, "");
          decls.push({ name, text });
          i = end;
          continue;
        }
      }
    }
    i += 1;
  }
  return decls;
}

function referenced(text: string, names: Iterable<string>, self: string): string[] {
  const hits: string[] = [];
  for (const name of names) {
    if (name === self) continue;
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) hits.push(name);
  }
  return hits;
}

function renameHead(text: string, from: string, to: string): string {
  if (from === to) return text;
  return text.replace(new RegExp(`^(interface|type)\\s+${from}\\b`), `$1 ${to}`);
}

export interface InlinedTypes {
  /** Names from the import that were found and copied. */
  found: string[];
  /** Declaration text, dependencies first, with `export` removed. */
  block: string;
}

/**
 * Copy the interfaces and type aliases a component imports into that component.
 * Names the file does not declare (functions, missing types) stay on the import.
 * A type that mentions another type from the same file pulls that declaration in too.
 */
export function inlineTypesFromFile(
  source: string,
  requested: { imported: string; local: string }[],
  follow?: (specifier: string, names: string[]) => TypeDecl[],
): InlinedTypes {
  const decls = new Map<string, string>();
  for (const d of extractTypeDeclarations(source)) decls.set(d.name, d.text);
  if (follow) {
    const imported = parseImports(source).flatMap((imp) => imp.named.map((n) => ({ name: n.imported, from: imp.specifier })));
    const mentioned = new Set(requested.map((r) => r.imported));
    for (const text of decls.values()) {
      for (const item of imported) {
        if (new RegExp(`\\b${item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) mentioned.add(item.name);
      }
    }
    const byFile = new Map<string, string[]>();
    for (const name of mentioned) {
      if (decls.has(name)) continue;
      const hit = imported.find((n) => n.name === name);
      if (!hit) continue;
      const list = byFile.get(hit.from) ?? [];
      list.push(name);
      byFile.set(hit.from, list);
    }
    for (const [spec, names] of byFile) {
      for (const d of follow(spec, names)) if (!decls.has(d.name)) decls.set(d.name, d.text);
    }
  }
  const locals = new Map(requested.map((r) => [r.imported, r.local]));
  const emitted = new Set<string>();
  const lines: string[] = [];
  const found: string[] = [];
  const emit = (name: string) => {
    if (emitted.has(name) || !decls.has(name)) return;
    emitted.add(name);
    const text = decls.get(name)!;
    for (const dep of referenced(text, decls.keys(), name)) emit(dep);
    const local = locals.get(name) ?? name;
    if (locals.has(name)) found.push(name);
    lines.push(renameHead(text, name, local));
  };
  for (const name of requested.map((r) => r.imported)) emit(name);
  return { found, block: lines.join("\n\n") };
}

export interface TypeImportContext {
  fromFile: string;
  sources: Map<string, string>;
  aliases: AliasConfig;
  fileSet: Set<string>;
}

/** Resolve and inline `import { SomeProps }` from a local types module. */
export function inlineTypeImport(imp: ParsedImport, ctx: TypeImportContext, depth = 0): InlinedTypes {
  if (depth > 4 || !imp.named.length) return { found: [], block: "" };
  const res = resolveImport(imp.specifier, ctx.fromFile, ctx.aliases, ctx.fileSet);
  const text = res.path ? ctx.sources.get(res.path) : undefined;
  if (!text || !res.path) return { found: [], block: "" };
  return inlineTypesFromFile(text, imp.named, (specifier, names) => {
    const nested = resolveImport(specifier, res.path!, ctx.aliases, ctx.fileSet);
    const nestedText = nested.path ? ctx.sources.get(nested.path) : undefined;
    if (!nestedText) return [];
    const inner = inlineTypesFromFile(nestedText, names.map((name) => ({ imported: name, local: name })), (spec, more) => {
      if (depth >= 4) return [];
      const again = inlineTypeImport({ ...imp, specifier: spec, named: more.map((name) => ({ imported: name, local: name })), raw: "" }, { ...ctx, fromFile: nested.path! }, depth + 1);
      return extractTypeDeclarations(again.block);
    });
    return extractTypeDeclarations(inner.block);
  });
}
