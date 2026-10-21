import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { optimizeImage } from "@/lib/themeforge/images";
import { themeSpecSchema } from "@/lib/themeforge/spec";
import { loadBundledSpec, makeTempDir } from "./helpers";

let dir: string;
let opts: Awaited<ReturnType<typeof loadBundledSpec>>["assets"]["optimizeImages"];

beforeAll(async () => {
  dir = await makeTempDir("themeforge-img-");
  opts = (await loadBundledSpec()).assets.optimizeImages;
  // A noisy 3000x1500 JPEG at quality 100 compresses well and is wider than maxWidth.
  const noise = Buffer.alloc(3000 * 1500 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 251;
  await sharp(noise, { raw: { width: 3000, height: 1500, channels: 3 } }).jpeg({ quality: 100 }).toFile(path.join(dir, "big.jpg"));
  await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toFile(path.join(dir, "flat.png"));
  await fs.writeFile(path.join(dir, "tiny.png"), await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer());
  await fs.writeFile(path.join(dir, "broken.jpg"), Buffer.from("not really a jpeg, but long enough to pass the minimum size threshold ".repeat(400)));
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe("optimizeImage", () => {
  it("compresses and downsizes a large JPEG, keeping the extension", async () => {
    const out = path.join(dir, "out-big.jpg");
    const r = await optimizeImage(path.join(dir, "big.jpg"), out, opts);
    expect(r.action).toBe("optimized");
    expect(r.resized).toBe(true);
    expect(r.width).toBe(1920);
    expect(r.finalBytes).toBeLessThan(r.originalBytes * 0.8);
    expect((await sharp(out).metadata()).format).toBe("jpeg");
  });

  it("leaves tiny files untouched and copies them byte-for-byte", async () => {
    const out = path.join(dir, "out-tiny.png");
    const r = await optimizeImage(path.join(dir, "tiny.png"), out, opts);
    expect(r.action).toBe("copied");
    expect(await fs.readFile(out)).toEqual(await fs.readFile(path.join(dir, "tiny.png")));
  });

  it("falls back to a plain copy when the file cannot be decoded", async () => {
    const out = path.join(dir, "out-broken.jpg");
    const r = await optimizeImage(path.join(dir, "broken.jpg"), out, opts);
    expect(r.action).toBe("copied");
    expect(r.reason).toMatch(/failed/);
    expect((await fs.stat(out)).size).toBe(r.originalBytes);
  });

  it("never writes a larger file than the original", async () => {
    const src = path.join(dir, "flat.png");
    const out = path.join(dir, "out-flat.png");
    const r = await optimizeImage(src, out, { ...opts, minBytes: 0 });
    expect(r.finalBytes).toBeLessThanOrEqual(r.originalBytes);
  });

  it("releases the source file immediately, even on the copy fallback (Windows temp cleanup)", async () => {
    // Regression: sharp(path) keeps a libvips handle open until GC, which made rm of the clone hang.
    const src = path.join(dir, "flat-copy.png");
    await fs.copyFile(path.join(dir, "flat.png"), src);
    await optimizeImage(src, path.join(dir, "out-flat-copy.png"), { ...opts, minBytes: 0 });
    await expect(fs.rm(src, { maxRetries: 0 })).resolves.toBeUndefined();
    const src2 = path.join(dir, "broken-copy.jpg");
    await fs.copyFile(path.join(dir, "broken.jpg"), src2);
    await optimizeImage(src2, path.join(dir, "out-broken-copy.jpg"), opts);
    await expect(fs.rm(src2, { maxRetries: 0 })).resolves.toBeUndefined();
  });

  it("is a no-op copy when disabled in the spec", async () => {
    const out = path.join(dir, "out-disabled.jpg");
    const r = await optimizeImage(path.join(dir, "big.jpg"), out, { ...opts, enabled: false });
    expect(r.action).toBe("copied");
    expect(r.reason).toBe("disabled");
  });

  it("spec defaults are applied when the assets block is absent", () => {
    const minimal = themeSpecSchema.parse({
      name: "x",
      requiredDirectories: ["components"],
      naming: {},
      sources: {},
      mappings: [{ id: "a", kind: "image", match: ["**/*.png"], target: "assets/{basename}" }],
      exclude: {},
      conflicts: {},
      transformations: {},
      validation: {},
      themeJson: {},
    });
    expect(minimal.assets.optimizeImages.enabled).toBe(true);
    expect(minimal.assets.optimizeImages.maxWidth).toBe(1920);
  });
});
