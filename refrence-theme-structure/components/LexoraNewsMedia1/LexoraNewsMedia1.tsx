"use client";
import { mapThemeUploadAssetsInData } from "../../../lib/restaurantFoodAssets";
function mediaSrc(src?: string) {
  const t = String(src || "").trim();
  if (!t) return "";
  if (/^(https?:|data:|blob:)/i.test(t)) return t;
  return t.startsWith("/") ? t : `/${t}`;
}

import React from 'react';

export default function LexoraNewsMedia1({ data = {} }: { data?: Record<string, any> }) {
  (() => { if (typeof document === "undefined") return; if (document.getElementById("theme-upload-css-vars")) return; const s = document.createElement("style"); s.id = "theme-upload-css-vars"; s.textContent = ":root{--color-primary:#0a1828;--color-accent:#c49250;--color-bg-light:#f8f9fa;--color-text:#333333;--color-text-light:#666666;--color-bg-main:#ffffff;}"; document.head.appendChild(s); })();
  data = mapThemeUploadAssetsInData(data);
  if (!data || typeof data !== "object") data = {};
  if (!data || !data.items) return null;

  return (
    <section className="py-12 lg:py-16 bg-[#fafafa]">
      <div className="max-w-[1250px] mx-auto px-5">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-[20px] md:gap-[30px]">
          {data.items.map((item, index) => {
            const content = (
              <div 
                key={`${item.id}-${index}`} 
                className="bg-white rounded-lg border border-[#f0f0f0] shadow-[0_5px_15px_rgba(0,0,0,0.03)] p-[20px] md:p-[30px] flex items-center justify-center transition-all duration-300 hover:shadow-[0_15px_30px_rgba(0,0,0,0.08)] hover:-translate-y-1 aspect-[3/2]"
              >
                <img 
                  src={item.image} 
                  alt={item.title} 
                  className="max-w-[80%] max-h-[80%] object-contain opacity-80 transition-opacity duration-300 hover:opacity-100" 
                />
              </div>
            );
            
            return item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" key={`${item.id}-${index}-link`} className="block">
                {content}
              </a>
            ) : content;
          })}
        </div>
      </div>
    </section>
  );
};

(LexoraNewsMedia1 as typeof LexoraNewsMedia1 & { editorFields: readonly string[] }).editorFields = ["items"];
