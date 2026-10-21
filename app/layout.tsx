import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ThemeForge — local theme generator",
  description: "Analyze a Git repository and generate a structured theme folder. Runs entirely on your machine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
