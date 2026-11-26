import archiver from "archiver";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Zip `sourceDir` into `zipPath` with the theme files at the archive root
 * (`theme.json`, `components/…`, `assets/…`, `lib/…`). No wrapper folder.
 */
export async function zipDirectory(sourceDir: string, zipPath: string): Promise<{ bytes: number }> {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await fs.rm(zipPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 6 } });
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (w) => {
      if ((w as NodeJS.ErrnoException).code !== "ENOENT") reject(w);
    });
    archive.pipe(output);
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
  const st = await fs.stat(zipPath);
  return { bytes: st.size };
}
