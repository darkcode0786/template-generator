const OVERLAY_BY_SECTION: Record<string, string> = {
  Banner: "--color-navy-overlay",
  Footer: "--color-footer-overlay",
  Stats: "--color-achievements-overlay",
  Breadcrumb: "--color-breadcrumb-overlay-rgba",
};

function endOfTag(code: string, start: number): number {
  let quote: string | null = null;
  let brace = 0;
  for (let i = start; i < code.length; i++) {
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
    if (ch === "{") brace += 1;
    else if (ch === "}") brace = Math.max(0, brace - 1);
    else if (ch === ">" && brace === 0) return i + 1;
  }
  return -1;
}

function srcExpr(tag: string): string | null {
  const braced = /\bsrc=\{([\s\S]*?)\}/.exec(tag);
  if (braced) return braced[1].trim();
  const literal = /\bsrc=(["'])([^"']+)\1/.exec(tag);
  if (literal) return JSON.stringify(literal[2]);
  return null;
}

/** Click-to-replace overlay, plus the theme veil on banner / footer / breadcrumb / stats photos. */
export function applyEditorMedia(code: string, sectionType: string): string {
  const overlay = OVERLAY_BY_SECTION[sectionType];
  if (overlay) {
    code = code.replace(/var\(\s*--(?:color-)?overlay\s*\)/g, `var(${overlay})`);
    code = code.replace(/\bbg-black\/(?:40|50|60|70|75|80)\b/g, `bg-[var(${overlay})]`);
  }

  const pieces: { start: number; end: number; text: string }[] = [];
  for (const match of code.matchAll(/<(img|Image)\b/g)) {
    const start = match.index ?? 0;
    const end = endOfTag(code, start);
    if (end < 0) continue;
    const tag = code.slice(start, end);
    if (/\bdata-editor-media\b/.test(tag)) continue;
    const src = srcExpr(tag);
    if (!src) continue;
    const role = /logo/i.test(tag) ? ` data-editor-media-role="logo"` : "";
    const attrs = ` data-editor-media data-editor-media-type="image" data-editor-media-src={${src}}${role} data-editor-media-overlay="show"`;
    const text = tag.replace(/\s*\/?>$/, (close) => `${attrs}${close.startsWith("/") || /\/\s*>$/.test(tag) ? " />" : ">"}`);
    pieces.push({ start, end, text });
  }
  for (const piece of pieces.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, piece.start) + piece.text + code.slice(piece.end);
  }

  // Do not paint a new full-bleed veil. A logo or a photo that already has its
  // own gradient would sit under `absolute inset-0` and the whole section washes out.
  return code;
}
