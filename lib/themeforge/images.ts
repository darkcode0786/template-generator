import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ThemeSpec } from "./spec";

export type ImageOptimizeOptions = ThemeSpec["assets"]["optimizeImages"];

export interface ImageOptimizeResult {
  /** "optimized" = compressed output written; "copied" = original kept (not smaller / unsupported / too small / failed). */
  action: "optimized" | "copied";
  originalBytes: number;
  finalBytes: number;
  width?: number;
  height?: number;
  resized: boolean;
  reason?: string;
}

const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".jfif"]);

/**
 * Compress an image into `dest` keeping its format. Never enlarges, never
 * changes the extension, and falls back to a byte-for-byte copy whenever the
 * optimized output would not be smaller or the file cannot be decoded.
 */
export async function optimizeImage(src: string, dest: string, opts: ImageOptimizeOptions): Promise<ImageOptimizeResult> {
  const ext = path.extname(src).toLowerCase();
  const originalBytes = (await fs.stat(src)).size;
  const copy = async (reason: string): Promise<ImageOptimizeResult> => {
    await fs.copyFile(src, dest);
    return { action: "copied", originalBytes, finalBytes: originalBytes, resized: false, reason };
  };

  if (!opts.enabled) return copy("disabled");
  if (!SUPPORTED.has(ext)) return copy("format not optimized");
  if (originalBytes < opts.minBytes) return copy(`smaller than ${opts.minBytes} bytes`);

  try {
    // Decode from a Buffer, not a path: with a path libvips keeps the file handle open until the
    // sharp object is garbage-collected, which on Windows blocks deleting the temporary clone.
    const bytes = await fs.readFile(src);
    const input = sharp(bytes, { failOn: "none", limitInputPixels: 80_000_000, animated: false });
    const meta = await input.metadata();
    let pipeline = input.rotate(); // honour EXIF orientation, then strip metadata
    let resized = false;
    if (opts.maxWidth > 0 && (meta.width ?? 0) > opts.maxWidth) {
      pipeline = pipeline.resize({ width: opts.maxWidth, withoutEnlargement: true });
      resized = true;
    }
    switch (ext) {
      case ".jpg":
      case ".jpeg":
      case ".jfif":
        pipeline = pipeline.jpeg({ quality: opts.jpegQuality, mozjpeg: true, progressive: true });
        break;
      case ".png":
        pipeline = pipeline.png({ compressionLevel: 9, palette: opts.pngPalette, quality: opts.pngQuality, effort: 7 });
        break;
      case ".webp":
        pipeline = pipeline.webp({ quality: opts.webpQuality, effort: 5 });
        break;
      case ".avif":
        pipeline = pipeline.avif({ quality: opts.avifQuality, effort: 4 });
        break;
    }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    if (!resized && data.length >= originalBytes) return copy("original already smaller");
    await fs.writeFile(dest, data);
    return { action: "optimized", originalBytes, finalBytes: data.length, width: info.width, height: info.height, resized };
  } catch (err) {
    return copy(`decode/encode failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Encode a copied image as `assets/preview.webp` for the template card. */
export async function writePreviewWebp(src: string, dest: string): Promise<boolean> {
  try {
    const bytes = await fs.readFile(src);
    const webp = await sharp(bytes, { failOn: "none", animated: false }).rotate().webp({ quality: 80 }).toBuffer();
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, webp);
    return true;
  } catch {
    return false;
  }
}

export function formatSavings(original: number, final: number): string {
  const saved = original - final;
  const pct = original ? Math.round((saved / original) * 100) : 0;
  const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
  return `${mb(original)} MB -> ${mb(final)} MB (saved ${pct}%)`;
}
