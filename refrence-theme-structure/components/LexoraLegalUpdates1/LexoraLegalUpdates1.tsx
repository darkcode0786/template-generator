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

import { FaArrowRight } from 'react-icons/fa';

export default function LexoraLegalUpdates1({ data = {} }: { data?: Record<string, any> }) {
  (() => { if (typeof document === "undefined") return; if (document.getElementById("theme-upload-css-vars")) return; const s = document.createElement("style"); s.id = "theme-upload-css-vars"; s.textContent = ":root{--color-primary:#0a1828;--color-accent:#c49250;--color-bg-light:#f8f9fa;--color-text:#333333;--color-text-light:#666666;--color-bg-main:#ffffff;}"; document.head.appendChild(s); })();
  data = mapThemeUploadAssetsInData(data);
  if (!data || typeof data !== "object") data = {};
  if (!data || typeof data !== 'object') data = {};

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="max-w-[1200px] mx-auto px-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[40px] items-center mb-8">
          <div>
            <div className="text-[#c49250] text-[13px] font-bold tracking-[2px] uppercase mb-[15px]">
              {data.badge}
            </div>
            <h2 className="text-[36px] md:text-[46px] text-[#051024] font-bold m-0 font-family-[var(--)] leading-[1.2]">
              {data.title}
            </h2>
            <div className="w-[40px] h-[2px] bg-[#c49250] mt-[20px]"></div>
            <p className="mt-[20px] text-[#666666] text-[16px] leading-[1.8] max-w-[500px]">
              {data.subtitle}
            </p>
          </div>
          <div className="rounded-[15px] overflow-hidden shadow-[0_15px_30px_rgba(0,0,0,0.08)]">
            <img 
              src={(data as any).headerImage || '/banner/ban1.jpg'} 
              alt={data.title} 
              className="w-full h-auto object-cover max-h-[250px]" 
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[30px]">
          {data.items.map(item => (
            <div key={item.id} className="bg-white rounded-lg overflow-hidden border border-[#f0f0f0] shadow-[0_5px_15px_rgba(0,0,0,0.03)] transition-all duration-300 hover:shadow-[0_15px_30px_rgba(0,0,0,0.08)] hover:-translate-y-2 flex flex-col h-full group">
              <div className="h-[240px] overflow-hidden">
                <img 
                  src={item.image} 
                  alt={item.title} 
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                />
              </div>
              
              <div className="p-[30px] flex flex-col flex-1">
                <div className="flex items-center text-[12px] font-bold mb-[15px] uppercase tracking-[1px]">
                  <span className="text-[#c49250]">{item.category}</span>
                  <span className="mx-[10px] text-[#e5e7eb]">|</span>
                  <span className="text-[#666666]">{item.date}</span>
                </div>
                
                <Link href={`/legal-updates/${item.slug || item.id}`} className="text-[22px] text-[#051024] font-bold mb-[15px] leading-[1.4] transition-colors duration-300 hover:text-[#c49250] font-family-[var(--)] line-clamp-3 min-h-[93px]">
                  {item.title}
                </Link>
                
                <p className="text-[#666666] text-[15px] leading-[1.7] mb-[25px] flex-1">
                  {item.excerpt}
                </p>
                
                <Link href={`/legal-updates/${item.slug || item.id}`} className="inline-flex items-center gap-[10px] text-[#c49250] text-[14px] font-bold hover:text-[#051024] transition-colors mt-auto">
                  Read More <FaArrowRight className="text-[12px]" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

(LexoraLegalUpdates1 as typeof LexoraLegalUpdates1 & { editorFields: readonly string[] }).editorFields = ["badge","title","subtitle","items"];
