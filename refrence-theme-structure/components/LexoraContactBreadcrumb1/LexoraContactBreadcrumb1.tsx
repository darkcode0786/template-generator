"use client";
import { mapThemeUploadAssetsInData } from "../../../lib/restaurantFoodAssets";
function mediaSrc(src?: string) {
  const t = String(src || "").trim();
  if (!t) return "";
  if (/^(https?:|data:|blob:)/i.test(t)) return t;
  return t.startsWith("/") ? t : `/${t}`;
}

import React from 'react';

import Link from 'next/link';

export default function LexoraContactBreadcrumb1({ data = {} }: { data?: Record<string, any> }) {
  (() => { if (typeof document === "undefined") return; if (document.getElementById("theme-upload-css-vars")) return; const s = document.createElement("style"); s.id = "theme-upload-css-vars"; s.textContent = ":root{--color-primary:#0a1828;--color-accent:#c49250;--color-bg-light:#f8f9fa;--color-text:#333333;--color-text-light:#666666;--color-bg-main:#ffffff;}"; document.head.appendChild(s); })();
  data = mapThemeUploadAssetsInData(data);
  if (!data || typeof data !== "object") data = {};
  if (!data || typeof data !== 'object') data = {};

  return (
    <section
      className="relative bg-cover bg-center bg-no-repeat py-[100px] px-5 text-center md:py-[70px]"
      style={{ backgroundImage: `url(${mediaSrc(data.bgImage)})` }}
    >
      {/* Dark Overlay */}
      <div className="absolute inset-0 bg-[rgba(10,24,40,0.75)]" />

      {/* Content */}
      <div className="relative z-[2] max-w-[1200px] mx-auto flex flex-col items-center">

        {/* Page Title */}
        <h1 className="text-white text-[32px] md:text-[52px] font-bold mb-4 md:mb-6 leading-[1.2]">
          {data.title}
        </h1>

        {/* Breadcrumb Path */}
        <ul className="flex items-center gap-3 list-none p-0 m-0 flex-wrap justify-center">
          {data.paths.map((path, index) => (
            <li key={path.label} className="flex items-center gap-3 text-[15px] font-semibold">
              {path.url ? (
                <Link
                  href={path.url}
                  className="text-white transition-colors duration-300 hover:text-[#c49250]"
                >
                  {path.label}
                </Link>
              ) : (
                <span className="text-white">{path.label}</span>
              )}
              {index < data.paths.length - 1 && (
                <span className="text-white text-[14px] flex items-center">
                  &rarr;
                </span>
              )}
            </li>
          ))}
        </ul>

      </div>
    </section>
  );
};

(LexoraContactBreadcrumb1 as typeof LexoraContactBreadcrumb1 & { editorFields: readonly string[] }).editorFields = ["title","paths","bgImage"];
