"use client";

import { useState } from "react";
import type { TreeNode } from "@/lib/themeforge/types";
import { formatBytes } from "./types";

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (node.type === "file") {
    return (
      <li className="flex items-center justify-between gap-2 py-0.5 font-mono text-xs" style={{ paddingLeft: depth * 14 }}>
        <span className="truncate text-gray-700">{node.name}</span>
        <span className="shrink-0 text-gray-400">{formatBytes(node.size ?? 0)}</span>
      </li>
    );
  }
  const childCount = node.children?.length ?? 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 py-0.5 text-left font-mono text-xs font-semibold text-gray-900 hover:bg-gray-50"
        style={{ paddingLeft: depth * 14 }}
        aria-expanded={open}
      >
        <span className="inline-block w-3 text-gray-400">{open ? "▾" : "▸"}</span>
        <span>{node.name}/</span>
        <span className="ml-1 font-normal text-gray-400">({childCount})</span>
      </button>
      {open && childCount > 0 && (
        <ul>
          {node.children!.map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FolderTree({ tree }: { tree: TreeNode }) {
  return (
    <ul className="max-h-[480px] overflow-auto rounded-md border border-border bg-white p-2">
      <Node node={tree} depth={0} />
    </ul>
  );
}
