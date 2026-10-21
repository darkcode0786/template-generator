import { describe, expect, it } from "vitest";
import { generationInputSchema, isPrivateAddress, RepoUrlError, validateRepoUrl } from "@/lib/themeforge/validation";

describe("validateRepoUrl", () => {
  it("accepts a GitHub HTTPS URL and normalises it", () => {
    const r = validateRepoUrl("https://github.com/Shubh9540/computer-repairing ");
    expect(r).toEqual({ cloneUrl: "https://github.com/Shubh9540/computer-repairing.git", host: "github.com", owner: "Shubh9540", repo: "computer-repairing" });
  });

  it("strips .git, query and fragment", () => {
    expect(validateRepoUrl("https://gitlab.com/group/sub/project.git?x=1#readme").cloneUrl).toBe("https://gitlab.com/group/sub/project.git");
  });

  it.each([
    ["http://github.com/a/b", /HTTPS/],
    ["git@github.com:a/b.git", /HTTPS/],
    ["ssh://git@github.com/a/b", /HTTPS/],
    ["file:///C:/repo", /HTTPS/],
    ["https://user:pass@github.com/a/b", /Credentials/],
    ["https://github.com:8443/a/b", /port/],
    ["https://127.0.0.1/a/b", /IP address/],
    ["https://[::1]/a/b", /IP address|valid URL/],
    ["https://localhost/a/b", /Local network/],
    ["https://evil.example.com/a/b", /not an allowed/],
    ["https://github.com/onlyowner", /owner\/repo/],
    ["https://github.com/a/b/tree/main", /root URL/],
    ["https://github.com/../b", /unsupported characters|owner\/repo/],
    ["not a url", /whitespace|valid URL/],
    ["", /required/],
  ])("rejects %s", (url, re) => {
    expect(() => validateRepoUrl(url)).toThrowError(RepoUrlError);
    expect(() => validateRepoUrl(url)).toThrow(re);
  });
});

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "100.64.0.1"])(
    "%s is private",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["140.82.112.3", "8.8.8.8", "2606:4700::1111", "172.32.0.1"])("%s is public", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("generationInputSchema", () => {
  it("accepts the documented example", () => {
    const r = generationInputSchema.safeParse({ repoUrl: "https://github.com/Shubh9540/computer-repairing", category: "Repairing & Maintenance", template: "computer-repairing" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.specId).toBe("default-theme");
  });
  it("rejects path-like template names", () => {
    expect(generationInputSchema.safeParse({ repoUrl: "https://github.com/a/b", category: "x y", template: "../etc" }).success).toBe(false);
    expect(generationInputSchema.safeParse({ repoUrl: "https://github.com/a/b", category: "x y", template: "a/b" }).success).toBe(false);
  });
});
