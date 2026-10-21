import fs from "node:fs/promises";
import path from "node:path";
import type { TreeNode } from "./types";

/** Build a sorted folder tree (directories first) for the UI preview. */
export async function buildTree(root: string, maxEntries = 5000): Promise<TreeNode> {
  let count = 0;
  async function walk(dir: string, rel: string, name: string): Promise<TreeNode> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const children: TreeNode[] = [];
    for (const e of entries) {
      if (++count > maxEntries) break;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) children.push(await walk(abs, r, e.name));
      else {
        const st = await fs.stat(abs);
        children.push({ name: e.name, path: r, type: "file", size: st.size });
      }
    }
    return { name, path: rel, type: "dir", children };
  }
  return walk(root, "", path.basename(root));
}

export function countTree(node: TreeNode): { files: number; dirs: number; bytes: number } {
  if (node.type === "file") return { files: 1, dirs: 0, bytes: node.size ?? 0 };
  const acc = { files: 0, dirs: 1, bytes: 0 };
  for (const c of node.children ?? []) {
    const r = countTree(c);
    acc.files += r.files;
    acc.dirs += r.dirs;
    acc.bytes += r.bytes;
  }
  return acc;
}
