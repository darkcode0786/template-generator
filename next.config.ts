import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local-only tool: keep packages that touch the filesystem / spawn git out of the bundler.
  serverExternalPackages: ["archiver", "sharp"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
