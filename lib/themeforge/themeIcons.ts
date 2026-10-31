function ensureNamedImport(code: string, name: string, from: string): string {
  if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b`).test(code)) return code;
  const line = `import { ${name} } from "${from}";\n`;
  if (/^['"]use client['"];\s*\n/.test(code)) {
    return code.replace(/^(['"]use client['"];\s*\n)/, `$1${line}`);
  }
  return line + code;
}

/**
 * The template already draws its icons (`<FaStar />`, `renderIcon` switches, lucide maps).
 * Replacing those with `WebsiteIcon` drops every glyph that map does not know.
 */
export function rewriteDynamicIcons(code: string): string {
  return code;
}

/**
 * Editor pages are `#page-about`, not Next routes. A plain `href={link.url}`
 * leaves the preview. `toLestowHref` maps `/about` onto that hash.
 */
export function rewritePreviewHrefs(code: string): string {
  let out = code;
  const hadLink = /from\s+['"]next\/link['"]/.test(out) || /<Link\b/.test(out);
  if (hadLink) {
    out = out.replace(/^\s*import\s+Link\s+from\s+['"]next\/link['"]\s*;?\s*\n/m, "");
    out = out.replace(/<\/Link>/g, "</a>");
    out = out.replace(/<Link(\s|>)/g, "<a$1");
  }
  out = out.replace(
    /\bhref=\{(?!\s*toLestowHref\()([^{}()]+)\}/g,
    "href={toLestowHref($1)}",
  );
  out = out.replace(
    /\bhref=(['"])(\/(?!\/)[^'"]*)\1/g,
    (_match, _quote, path: string) => `href={toLestowHref(${JSON.stringify(path)})}`,
  );
  if (!/\btoLestowHref\b/.test(out)) return out;
  return ensureNamedImport(out, "toLestowHref", "../../../lib/lexoraPreview");
}

function navHrefPattern(name: string): RegExp {
  return new RegExp(`\\bhref=\\{\\s*(?:toLestowHref\\(\\s*)?${name}\\??\\.(?:url|href)\\s*\\)?\\s*\\}`);
}

/**
 * Menu rows are saved as `url`, and some source headers read `href`.
 * The exported header reads whichever one is present, then maps it to `#page-…`.
 */
export function rewriteHeaderNavHrefs(code: string): string {
  let out = code;
  for (let pass = 0; pass < 40; pass += 1) {
    const mapRe = /\.map\s*\(\s*/g;
    let target: MapCallback | null = null;
    for (const match of out.matchAll(mapRe)) {
      const cb = parseMapCallback(out, (match.index ?? 0) + match[0].length);
      if (!cb) continue;
      const body = out.slice(cb.bodyStart, cb.bodyEnd);
      if (body.includes(`const ${cb.name}Href = ${cb.name}.url || ${cb.name}.href`)) continue;
      if (!navHrefPattern(cb.name).test(body)) continue;
      if (!target || cb.bodyStart > target.bodyStart) target = cb;
    }
    if (!target) break;
    const name = target.name;
    const raw = out.slice(target.bodyStart, target.bodyEnd);
    const replaced = raw.replace(navHrefPattern(name), `href={toLestowHref(${name}Href)}`);
    const lineStart = out.lastIndexOf("\n", target.bodyStart) + 1;
    const indent = /^[ \t]*/.exec(out.slice(lineStart, target.bodyStart))?.[0] ?? "";
    const decl = `const ${name}Href = ${name}.url || ${name}.href;`;
    let next = replaced;
    if (out[target.bodyStart] === "{") next = `{${`\n${indent}  ${decl}`}${replaced.slice(1)}`;
    else next = `{\n${indent}  ${decl}\n${indent}  return ${replaced};\n${indent}}`;
    out = out.slice(0, target.bodyStart) + next + out.slice(target.bodyEnd);
  }
  return out;
}

function ensureImportLine(code: string, line: string, symbol: string): string {
  if (new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b`).test(code)) return code;
  if (/^['"]use client['"];\s*\n/.test(code)) {
    return code.replace(/^(['"]use client['"];\s*\n)/, `$1${line}`);
  }
  return line + code;
}

function insertPreviewNavHook(code: string): string {
  if (/\busePreview\s*\(/.test(code)) return code;
  const patterns = [
    /export\s+default\s+function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/,
    /export\s+function\s+[A-Z][\w$]*\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/,
    /export\s+const\s+[A-Z][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+?)?\s*=>\s*\{/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(code);
    if (!match) continue;
    const brace = (match.index ?? 0) + match[0].length - 1;
    if (code[brace] !== "{") continue;
    return `${code.slice(0, brace + 1)}\n  const previewNav = usePreview();\n${code.slice(brace + 1)}`;
  }
  return code;
}

/**
 * A hash href does not switch the editor page. The click has to call
 * `setCurrentPage`, which is what the host headers do.
 */
export function bindPreviewNavClicks(code: string, landing = false): string {
  let changed = false;
  const click = landing
    ? ` onClick={(event) => { const href = event.currentTarget.getAttribute("href") || ""; if (/^(mailto:|tel:|https?:)/i.test(href)) return; event.preventDefault(); event.stopPropagation(); handlePreviewMenuNavigate(href, href.replace(/^#/, "") || "Home", previewNav?.setCurrentPage); }} data-editor-no-inline="true"`
    : ` onClick={(event) => { event.preventDefault(); const href = event.currentTarget.getAttribute("href") || ""; const slug = href.replace(/^#page-/i, ""); handlePreviewMenuNavigate(href, slug, previewNav.setCurrentPage); }}`;
  const pattern = landing
    ? /<a\b([^>]*?\bhref=(?:\{toLestowHref\([^)]*\)\}|"#[^"]*"|'#[^']*'|\{["']#[^"']*["']\})[^>]*)>/g
    : /<a\b([^>]*?\bhref=\{toLestowHref\([^)]*\)\}[^>]*)>/g;
  const next = code.replace(pattern, (full, attrs: string) => {
    if (/\bonClick\s*=/.test(attrs)) return full;
    if (landing && /\bhref=["'](?:mailto:|tel:|https?:)/i.test(attrs)) return full;
    changed = true;
    return `<a${attrs}${click}>`;
  });
  if (!changed) return code;
  let out = insertPreviewNavHook(next);
  if (!/\busePreview\s*\(/.test(out)) return code;
  out = ensureImportLine(out, 'import { usePreview } from "../../context/PreviewContext";\n', "usePreview");
  out = ensureImportLine(out, 'import { handlePreviewMenuNavigate } from "../../../lib/sectionScroll";\n', "handlePreviewMenuNavigate");
  return out;
}

/**
 * `'use client'` has to be the first statement. Upload rewrites were inserting
 * imports above a directive that the source had left further down the file.
 */
export function hoistUseClient(code: string): string {
  const lines = code.split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*['"]use client['"]\s*;?\s*$/.test(line));
  if (index < 0) return code;
  const newline = code.includes("\r\n") ? "\r\n" : "\n";
  if (!lines.slice(0, index).some((line) => line.trim())) {
    if (index === 0) return code;
    const rest = lines.slice(index);
    rest[0] = "'use client';";
    return rest.join(newline);
  }
  const rest = [...lines.slice(0, index), ...lines.slice(index + 1)];
  while (rest[0] === "") rest.shift();
  return `'use client';${newline}${rest.join(newline)}`;
}

function skipWs(code: string, i: number): number {
  while (i < code.length && /\s/.test(code[i]!)) i += 1;
  return i;
}

function matchingCloser(code: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i]!;
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(params: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < params.length; i += 1) {
    const ch = params[i]!;
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[" || ch === "<") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]" || ch === ">") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(params.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(params.slice(start));
  return parts.filter((part) => part.trim());
}

type MapCallback = {
  name: string;
  indexName: string | null;
  bare: boolean;
  parenStart: number;
  paramsClose: number;
  bodyStart: number;
  bodyEnd: number;
};

function parseMapCallback(code: string, i: number): MapCallback | null {
  i = skipWs(code, i);
  let name = "";
  let indexName: string | null = null;
  let bare = false;
  const parenStart = i;
  let afterParams = i;
  let paramsClose = i;

  if (code[i] === "(") {
    const close = matchingCloser(code, i, "(", ")");
    if (close < 0) return null;
    const parts = splitTopLevel(code.slice(i + 1, close));
    if (!parts.length || parts.length > 2) return null;
    const first = /^([A-Za-z_$][\w$]*)\b/.exec(parts[0]!.trim());
    if (!first) return null;
    name = first[1]!;
    if (parts[1]) {
      const second = /^([A-Za-z_$][\w$]*)\b/.exec(parts[1]!.trim());
      if (!second) return null;
      indexName = second[1]!;
    }
    paramsClose = close;
    afterParams = close + 1;
  } else {
    const ident = /^([A-Za-z_$][\w$]*)/.exec(code.slice(i));
    if (!ident) return null;
    name = ident[1]!;
    bare = true;
    afterParams = i + name.length;
    paramsClose = afterParams;
  }

  const arrowAt = skipWs(code, afterParams);
  if (code.slice(arrowAt, arrowAt + 2) !== "=>") return null;
  const bodyStart = skipWs(code, arrowAt + 2);
  const opener = code[bodyStart];
  let bodyEnd = -1;
  if (opener === "{") bodyEnd = matchingCloser(code, bodyStart, "{", "}") + 1;
  else if (opener === "(") bodyEnd = matchingCloser(code, bodyStart, "(", ")") + 1;
  else bodyEnd = expressionEnd(code, bodyStart);
  if (bodyEnd <= bodyStart) return null;
  return { name, indexName, bare, parenStart, paramsClose, bodyStart, bodyEnd };
}

function expressionEnd(code: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i]!;
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) return i;
      depth -= 1;
    } else if (ch === "," && depth === 0) return i;
  }
  return -1;
}

/**
 * Uploaded lists often have no `id` (the editor hides it and nav saves omit it).
 * `key={item.id}` is then undefined for every row. Fall back to the map index.
 */
export function stabilizeListKeys(code: string): string {
  const keyRe = /\bkey=\{\s*([A-Za-z_$][\w$]*)\??\.id\s*\}/g;
  const owners = new Map<number, { cb: MapCallback; keys: number[] }>();
  for (const match of code.matchAll(keyRe)) {
    const keyAt = match.index ?? 0;
    const name = match[1]!;
    let owner: MapCallback | null = null;
    const mapRe = /\.map\s*\(\s*/g;
    for (const mapMatch of code.matchAll(mapRe)) {
      const start = mapMatch.index ?? 0;
      if (start > keyAt) break;
      const cb = parseMapCallback(code, start + mapMatch[0].length);
      if (!cb || cb.name !== name || keyAt < cb.bodyStart || keyAt > cb.bodyEnd) continue;
      if (!owner || cb.bodyStart > owner.bodyStart) owner = cb;
    }
    if (!owner) continue;
    const group = owners.get(owner.parenStart) ?? { cb: owner, keys: [] };
    group.keys.push(keyAt);
    owners.set(owner.parenStart, group);
  }

  const edits: { start: number; end: number; text: string }[] = [];
  for (const { cb, keys } of owners.values()) {
    const indexName = cb.indexName ?? (cb.name === "index" ? "__key" : "index");
    if (!cb.indexName) {
      if (cb.bare) {
        edits.push({
          start: cb.parenStart,
          end: cb.parenStart + cb.name.length,
          text: `(${cb.name}, ${indexName})`,
        });
      } else {
        edits.push({ start: cb.paramsClose, end: cb.paramsClose, text: `, ${indexName}` });
      }
    }
    for (const keyAt of keys) {
      const slice = code.slice(keyAt);
      const end = slice.indexOf("}") + 1;
      edits.push({ start: keyAt, end: keyAt + end, text: `key={${cb.name}.id ?? ${indexName}}` });
    }
  }

  let out = code;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}
