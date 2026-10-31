import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { themeSpecSchema, type ThemeSpec } from "@/lib/themeforge/spec";

export async function makeTempDir(prefix = "themeforge-test-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function loadBundledSpec(): Promise<ThemeSpec> {
  const raw = await fs.readFile(path.join(process.cwd(), "templates", "default-theme.json"), "utf8");
  return themeSpecSchema.parse(JSON.parse(raw));
}

/** Write a map of relative path -> content into `root`. */
export async function writeFiles(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
}

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** A tiny synthetic Next.js App Router project resembling the real inputs. */
export async function createSyntheticNextRepo(root: string): Promise<void> {
  await writeFiles(root, {
    "package.json": JSON.stringify(
      {
        name: "synthetic-site",
        private: true,
        dependencies: { next: "16.0.0", react: "19.0.0", "react-dom": "19.0.0", "react-icons": "^5.0.0" },
        devDependencies: { tailwindcss: "^3.4.0", typescript: "^5" },
      },
      null,
      2,
    ),
    "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }`,
    ".gitignore": "node_modules\n",
    ".env": "SECRET_TOKEN=should-never-be-copied\n",
    ".env.local": "ANOTHER=secret\n",
    "secrets/id_rsa": "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n",
    "lib/keys.ts": `export const key = "-----BEGIN RSA PRIVATE KEY-----\\nMIIB\\n-----END RSA PRIVATE KEY-----";\n`,
    "node_modules/leftpad/index.js": "module.exports = () => {};",
    ".next/server/app/page.js": "built output",
    "public/partner.zip": "PK\u0003\u0004fake",
    "app/globals.css": ":root { --color-primary: #123456; }\n",
    "app/layout.tsx": `export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n`,
    "app/page.tsx": `import rawData from '@/data/templates.json';
import { TopBar } from '@/components/common/TopBar';
import { Header } from '@/components/common/Header';
import { Footer } from '@/components/common/Footer';
import { HeroSection } from '@/components/sections/HeroSection';
import { ServicesSection } from '@/components/sections/ServicesSection';

export default function Home() {
  const s = (rawData as any).categories['Synthetic'].sections;
  return (
    <main>
      <TopBar data={s.TopBar.variants['SyntheticTopBar1']} />
      <Header data={s.Header.variants['SyntheticHeader1']} />
      <HeroSection data={s.Hero.variants['SyntheticHero1']} />
      <ServicesSection data={s.Services.variants['SyntheticServices1']} />
      <Footer data={(rawData as any).common.Footer} />
    </main>
  );
}
`,
    "app/about/page.tsx": `import { TopBar } from '@/components/common/TopBar';
import { Header } from '@/components/common/Header';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { Footer } from '@/components/common/Footer';
export default function Page() {
  if (!data) {
    return (
      <main>
        <TopBar />
        <Header />
        <Footer />
      </main>
    );
  }
  return (<main><TopBar /><Header /><Breadcrumb data={{ title: 'About' }} /><Footer /></main>);
}
`,
    "app/contact/page.tsx": `import { TopBar } from '@/components/common/TopBar';
import { Header } from '@/components/common/Header';
import { Footer } from '@/components/common/Footer';
export default function Page() {
  return (<main><TopBar /><Header /><Footer /></main>);
}
`,
    "components/sections/SitemapLinks.tsx": `export const SitemapLinks = () => {
  const slug = 'repair';
  const pages = [
    { name: 'Home', url: '/' },
    { name: 'Contact Us', url: '/contact' },
    { name: 'About Us', url: '/about' },
  ];
  pages.push({ name: 'Service Detail', url: \`/services/\${slug}\` });
  return null;
};
`,
    "app/services/[id]/page.tsx": `import { Header } from '@/components/common/Header';
export default function Page() { return <Header />; }
`,
    "types/templates.types.ts": `export type SocialLink = { icon: string; url: string };
export interface TopBarData {
  phoneValue: string;
  emailValue: string;
  socials?: SocialLink[];
}
export interface UnusedPage { title: string }
export function notAType() { return 1; }
`,
    "components/common/TopBar.tsx": `'use client';
import React from 'react';
import { TopBarData } from '@/types/templates.types';
import { FaPhoneAlt } from 'react-icons/fa';
export const TopBar = ({ data }: { data?: TopBarData }) => {
  if (!data) return null;
  return <div><FaPhoneAlt /> {data.phoneValue} {data.emailValue}</div>;
};
`,
    "components/common/Header.tsx": `import React from 'react';
import Link from 'next/link';
import { TopBar } from './TopBar';
export const Header = ({ data }: { data?: any }) => {
  const { logo, menu } = data ?? {};
  return <header><TopBar data={data?.topbar} /><Link href="/"><img src={logo} alt="" /></Link>{menu?.length}</header>;
};
`,
    "components/common/Footer.tsx": `export default function Footer({ data }: { data?: any }) {
  return <footer>{data?.copyrightText}</footer>;
}
`,
    "components/common/Breadcrumb.tsx": `export const Breadcrumb = ({ data }: { data?: any }) => <nav>{data?.title}</nav>;
`,
    "components/sections/HeroSection.tsx": `import React from 'react';
import { motion } from 'framer-motion';
export const HeroSection = ({ data }: { data?: any }) => {
  if (!data) return null;
  const links = [...(data.linksLeft || []), ...(data.linksRight || [])];
  return (
    <section className="bg-[#123456] text-[#123456]" style={{ backgroundImage: \`url(\${data.imageMain})\` }}>
      <img src="/banner/banner.webp" alt="" />
      <div style={{ backgroundImage: "url(/service/laptop/01.webp)" }} />
      <span>{data.badge?.label} {data.badge?.value}</span>
      <h1>{data.title}</h1><p>{data.subtitle}</p>
      <button type="button">{data.previousLabel}{data.buttonText}</button>
      <span>{data.quoteIcon}</span>
      {data.cards?.map((card: any) => <div key={card.id}>{card.title}<p>{card.description}</p></div>)}
      {links.map((l: any) => <a key={l.url} href={l.url}>{l.label}</a>)}
    </section>
  );
};
`,
    "components/sections/ServicesSection.tsx": `import React from 'react';
import { helper } from '@/lib/missing-helper';
export const ServicesSection = ({ data }: { data?: any }) => <section>{data?.services?.map((s: any) => <div key={s.id}>{s.title}</div>)}</section>;
`,
    "components/sections/services.test.tsx": `test('x', () => {});`,
    "data/templates.json": JSON.stringify(
      {
        common: { Footer: { copyrightText: "© Synthetic", logo: "/main logo/footer logo.webp" } },
        categories: {
          Synthetic: {
            sections: {
              TopBar: { variants: { SyntheticTopBar1: { phoneValue: "+1 555", emailValue: "hi@example.com" } } },
              Header: { variants: { SyntheticHeader1: { logo: "/main logo/header logo.webp", menu: [{ label: "Home", url: "/" }] } } },
              Hero: {
                variants: {
                  SyntheticHero1: {
                    imageMain: "/banner/banner.webp",
                    title: "Hello",
                    subtitle: "World",
                    previousLabel: "Prev",
                    buttonText: "View Details",
                    quoteIcon: "quote",
                    badge: {},
                    cards: [],
                    linksLeft: [{ id: "l1", label: "Home", url: "/" }],
                  },
                },
              },
              Services: { variants: { SyntheticServices1: { services: [{ id: "s1", title: "Repair", image: "/service/laptop/01.webp" }] } } },
            },
          },
        },
      },
      null,
      2,
    ),
    // data kept next to the components (electrocare-style) must be found too
    "components/data/data.json": JSON.stringify({ common: { Breadcrumb: { title: "Breadcrumb from components/data" } } }),
    // never content: PWA manifest
    "public/manifest.json": JSON.stringify({ name: "pwa", title: "should not be used as Breadcrumb content" }),
    "public/banner/banner.webp": PNG_1x1,
    "public/main logo/header logo.webp": PNG_1x1,
    "public/main logo/footer logo.webp": PNG_1x1,
    "public/team/1.jpg": PNG_1x1,
    "public/service/laptop/01.webp": PNG_1x1,
    "public/next.svg": "<svg/>",
    "public/icons/star.svg": "<svg><path/></svg>",
    "public/fonts/Inter.woff2": Buffer.from([0x77, 0x4f, 0x46, 0x32]),
    "src/assets/fonts/Inter.woff2": Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00]),
  });
}
