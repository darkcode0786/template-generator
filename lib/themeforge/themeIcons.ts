/** Point dynamic icons at the host `WebsiteIcon`, which paints every editor dropdown value. */

function ensureNamedImport(code: string, name: string, from: string): string {
  if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b`).test(code)) return code;
  const line = `import { ${name} } from "${from}";\n`;
  if (/^['"]use client['"];\s*\n/.test(code)) {
    return code.replace(/^(['"]use client['"];\s*\n)/, `$1${line}`);
  }
  return line + code;
}

function paramName(params: string): string {
  const raw = params.split(",")[0]?.trim() ?? "";
  const name = raw.replace(/[?:=].*$/, "").replace(/:.*/, "").trim();
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : "iconName";
}

function endOfBlock(code: string, openBrace: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openBrace; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** `renderIcon` switches only know the icons that were imported. The dropdown can pick any of them. */
function rewriteRenderIconFns(code: string): string {
  const re = /(?:const|let)\s+renderIcon\s*=\s*\(([^)]*)\)\s*=>\s*\{|function\s+renderIcon\s*\(([^)]*)\)\s*\{/g;
  const pieces: { start: number; end: number; text: string }[] = [];
  for (const match of code.matchAll(re)) {
    const start = match.index ?? 0;
    const brace = start + match[0].length - 1;
    let end = endOfBlock(code, brace);
    if (end < 0) continue;
    if (code[end] === ";") end += 1;
    const body = code.slice(brace, end);
    if (body.includes("WebsiteIcon")) continue;
    const param = paramName(match[1] || match[2] || "iconName");
    pieces.push({
      start,
      end,
      text: `const renderIcon = (${param}?: string) => <WebsiteIcon name={String(${param} ?? "")} />;`,
    });
  }
  let out = code;
  for (const piece of pieces.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, piece.start) + piece.text + out.slice(piece.end);
  }
  return out;
}

function statementEnd(code: string, start: number): number {
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
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) return i + 1;
  }
  return -1;
}

/** Index expression whose key is an icon field: `map[item.icon]`, including a cast and a fallback. */
function iconIndexKey(expr: string): string | null {
  const match = expr.trim().match(/^(?:\([^[\]]+\)|[A-Za-z_$][\w$.]*)\s*\[\s*([^[\]]+?)\s*\](?:\s*\|\|[\s\S]+)?$/);
  if (!match) return null;
  const key = match[1]!.replace(/\s+/g, "");
  if (!/(?:^|\.)icon(?:Name)?\b/i.test(key) && !/icon/i.test(key)) return null;
  if (!/^[A-Za-z_$][\w$.?]*$/.test(key)) return null;
  return key;
}

/**
 * `cardIcons[card.icon]`, `socialIconMap[s.icon]`, and
 * `(LucideIcons as ...)[item.icon]` only know the names that were imported.
 * The editor dropdown can pick any of them, or an SVG path.
 */
function rewriteIconMapLookup(code: string): string {
  const re = /const\s+([A-Z][\w$]*)\s*=/g;
  const edits: { start: number; end: number; text: string }[] = [];
  for (const match of code.matchAll(re)) {
    const start = match.index ?? 0;
    const end = statementEnd(code, start + match[0].length);
    if (end < 0) continue;
    const key = iconIndexKey(code.slice(start + match[0].length, end - 1));
    if (!key) continue;
    const name = match[1]!;
    if (!/icon/i.test(name) && !/(?:^|\.)icon(?:Name)?\b/i.test(key)) continue;
    edits.push({
      start,
      end,
      text: `const ${name} = (props: { className?: string; size?: number; strokeWidth?: number }) => <WebsiteIcon name={String(${key} ?? "")} {...props} />;`,
    });
  }
  let out = code;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** `import Star from "./star.svg"` is not a component on the host. Paint the file. */
export function rewriteSvgModules(code: string, modules: { local: string; media: string }[]): string {
  let out = code;
  const leftovers: string[] = [];
  for (const mod of modules) {
    if (!/^[A-Za-z_$][\w$]*$/.test(mod.local)) continue;
    const src = `mediaSrc(${JSON.stringify(mod.media)})`;
    const name = mod.local;
    out = out.replace(new RegExp(`<${name}(\\s[^>]*?)?\\s*/>`, "g"), `<img src={${src}} alt=""$1 />`);
    out = out.replace(new RegExp(`<${name}(\\s[^>]*?)?>\\s*</${name}>`, "g"), `<img src={${src}} alt=""$1 />`);
    if (new RegExp(`\\b${name}\\b`).test(out)) leftovers.push(`const ${name} = ${src};`);
  }
  if (!leftovers.length) return out;
  const line = `${leftovers.join("\n")}\n`;
  if (/^['"]use client['"];\s*\n/.test(out)) return out.replace(/^(['"]use client['"];\s*\n)/, `$1${line}`);
  return line + out;
}

/** `{item.icon === "star" && <FaStar />}` paints nothing after the dropdown changes the name. */
function rewriteIconEquality(code: string): string {
  const replaced = code.replace(
    /\{[ \t]*([A-Za-z_$][\w$]*\??\.icon)\s*===\s*['"][^'"]+['"]\s*&&\s*<[A-Z][\w$]*\b[^>\n]*\/>\s*\}/g,
    '{<WebsiteIcon name={String($1 ?? "")} />}',
  );
  return replaced.replace(
    /(\{<WebsiteIcon name=\{String\(([^)]+) \?\? ""\)\} \/>\}\s*){2,}/g,
    '{<WebsiteIcon name={String($2 ?? "")} />}\n',
  );
}

export function rewriteDynamicIcons(code: string): string {
  const next = rewriteIconEquality(rewriteIconMapLookup(rewriteRenderIconFns(code)));
  if (next === code || !next.includes("WebsiteIcon")) return code;
  return ensureNamedImport(next, "WebsiteIcon", "../../../lib/websiteIcons");
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
