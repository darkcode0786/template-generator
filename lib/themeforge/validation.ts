import dns from "node:dns/promises";
import net from "node:net";
import { z } from "zod";
import { getConfig } from "./config";

export const generationInputSchema = z.object({
  repoUrl: z.string().trim().min(1, "Repository URL is required").max(512),
  category: z
    .string()
    .trim()
    .min(2, "Category must be at least 2 characters")
    .max(80)
    .regex(/^[A-Za-z0-9 &()\-_.,'/]+$/, "Category contains unsupported characters"),
  template: z
    .string()
    .trim()
    .min(2, "Template name must be at least 2 characters")
    .max(80)
    .regex(/^[A-Za-z0-9 \-_]+$/, "Template name may only contain letters, numbers, spaces, hyphens and underscores"),
  specId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default("default-theme"),
});

export type GenerationInput = z.infer<typeof generationInputSchema>;

export interface ValidatedRepoUrl {
  /** Normalised clone URL (https, no credentials, no fragment/query). */
  cloneUrl: string;
  host: string;
  owner: string;
  repo: string;
}

export class RepoUrlError extends Error {}

/**
 * Pure (no network) URL validation: HTTPS only, allow-listed hosts, no
 * credentials, no IP literals, no custom ports, an owner/repo path.
 */
export function validateRepoUrl(input: string, allowedHosts = getConfig().allowedGitHosts): ValidatedRepoUrl {
  const trimmed = input.trim();
  if (!trimmed) throw new RepoUrlError("Repository URL is required.");
  if (/\s/.test(trimmed)) throw new RepoUrlError("Repository URL must not contain whitespace.");
  if (/^(git@|ssh:|git:|file:|ftp:)/i.test(trimmed)) {
    throw new RepoUrlError("Only HTTPS repository URLs are supported.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RepoUrlError("Repository URL is not a valid URL.");
  }

  if (url.protocol !== "https:") throw new RepoUrlError("Only HTTPS repository URLs are supported.");
  if (url.username || url.password) throw new RepoUrlError("Credentials in the URL are not allowed.");
  if (url.port && url.port !== "443") throw new RepoUrlError("Custom ports are not allowed.");

  const host = url.hostname.toLowerCase();
  if (net.isIP(host) || host.startsWith("[")) throw new RepoUrlError("IP address hosts are not allowed.");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new RepoUrlError("Local network hosts are not allowed.");
  }
  if (!allowedHosts.includes(host)) {
    throw new RepoUrlError(`Host "${host}" is not an allowed Git provider. Allowed: ${allowedHosts.join(", ")}.`);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) throw new RepoUrlError("URL must point to a repository (https://host/owner/repo).");
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  const segOk = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!segOk.test(owner) || !segOk.test(repo) || repo === "." || repo === "..") {
    throw new RepoUrlError("Repository owner/name contains unsupported characters.");
  }
  // Reject deep paths like /owner/repo/tree/main — users should pass the repo root.
  if (segments.length > 2 && !(host === "gitlab.com" && segments.length <= 4)) {
    throw new RepoUrlError("Pass the repository root URL (https://host/owner/repo), not a sub-path.");
  }

  const pathPart = host === "gitlab.com" ? segments.map((s, i) => (i === segments.length - 1 ? s.replace(/\.git$/i, "") : s)).join("/") : `${owner}/${repo}`;
  return { cloneUrl: `https://${host}/${pathPart}.git`, host, owner, repo };
}

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const low = ip.toLowerCase();
  if (low === "::" || low === "::1") return true;
  if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique local
  if (low.startsWith("fe80")) return true; // link local
  if (low.startsWith("::ffff:")) return isPrivateIPv4(low.slice(7));
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true;
}

/**
 * Defence in depth against SSRF: even for allow-listed hosts, refuse to clone
 * if the host currently resolves to a private/loopback/link-local address.
 */
export async function assertPublicHost(host: string): Promise<void> {
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new RepoUrlError(`Could not resolve host "${host}". Check your internet connection.`);
  }
  if (addresses.length === 0) throw new RepoUrlError(`Host "${host}" did not resolve to any address.`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new RepoUrlError(`Host "${host}" resolves to a private network address (${address}); refusing to connect.`);
    }
  }
}
