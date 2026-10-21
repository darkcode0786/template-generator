"use client";
import React, { useEffect, useState } from "react";
import { FaArrowRight, FaAngleLeft, FaAngleRight } from "react-icons/fa";
import { mapThemeUploadAssetsInData } from "../../../lib/restaurantFoodAssets";

function mediaSrc(src?: string) {
  const t = String(src || "").trim();
  if (!t) return "";
  if (/^(https?:|data:|blob:)/i.test(t)) return t;
  return t.startsWith("/") ? t : `/${t}`;
}

export default function LexoraHero1({ data = {} }: { data?: Record<string, any> }) {
  (() => { if (typeof document === "undefined") return; if (document.getElementById("theme-upload-css-vars")) return; const s = document.createElement("style"); s.id = "theme-upload-css-vars"; s.textContent = ":root{--color-primary:#0a1828;--color-accent:#c49250;--color-bg-light:#f8f9fa;--color-text:#333333;--color-text-light:#666666;--color-bg-main:#ffffff;}"; document.head.appendChild(s); })();
  data = mapThemeUploadAssetsInData(data);
  if (!data || typeof data !== "object") data = {};
  const slides = Array.isArray(data.slides) ? data.slides : [];
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setActive((i) => (i + 1) % slides.length), 6000);
    return () => clearInterval(t);
  }, [slides.length]);
  if (!slides.length) return null;
  const go = (dir: number) => setActive((i) => (i + dir + slides.length) % slides.length);

  return (
    <section className="relative overflow-hidden bg-[#051024] h-[calc(100vh-120px)] min-h-[700px] md:min-h-[600px]">
      {slides.map((slide: any, idx: number) => {
        const isActive = idx === active;
        const titleLines = String(slide.title || "").split("\n");
        const subtitleLines = String(slide.subtitle || "").split("\n");
        return (
          <div key={slide.id || idx} className={`absolute inset-0 transition-opacity duration-1000 ${isActive ? "opacity-100 z-[1]" : "opacity-0 z-0 pointer-events-none"}`}>
            <div className={`absolute inset-0 bg-cover bg-center transition-transform duration-[6000ms] ease-linear ${isActive ? "scale-100" : "scale-105"}`} style={{ backgroundImage: `url(${mediaSrc(slide.image)})` }} />
            <div className="absolute inset-0 z-[1] bg-gradient-to-r from-[#051024]/95 via-[#051024]/70 to-[#051024]/20" />
            <div className="relative z-10 h-full max-w-[1200px] mx-auto px-5 flex items-center">
              <div className="max-w-[700px] text-white">
                <div className="mb-6 overflow-hidden">
                  <span className={`relative inline-flex flex-col items-start text-[#c49250] text-sm font-medium tracking-widest uppercase transition-all duration-700 after:block after:w-full after:h-px after:bg-[#c49250] after:mt-4 ${isActive ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"}`}>{slide.badge}</span>
                </div>
                <div className="mb-5 mt-5 overflow-hidden">
                  <h2 className={`text-4xl sm:text-5xl md:text-6xl font-bold leading-tight m-0 font-['Playfair_Display',_serif] transition-all duration-1000 ${isActive ? "translate-y-0 opacity-100" : "translate-y-24 opacity-0"}`}>
                    {titleLines.map((line: string, i: number) => (
                      <React.Fragment key={i}>
                        <span className={i === titleLines.length - 1 ? "text-[#c49250]" : "text-white"}>{line}</span>
                        <br />
                      </React.Fragment>
                    ))}
                  </h2>
                </div>
                <div className="mb-9 overflow-hidden">
                  <p className={`relative text-base sm:text-lg leading-relaxed text-gray-300 m-0 pt-5 transition-all duration-700 before:absolute before:top-0 before:left-0 before:w-9 before:h-0.5 before:bg-[#c49250] ${isActive ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`}>
                    {subtitleLines.map((line: string, i: number) => (
                      <React.Fragment key={i}>{line}<br /></React.Fragment>
                    ))}
                  </p>
                </div>
                <div className="overflow-hidden pb-2.5">
                  <a href={slide.buttonUrl || "#"} className={`inline-flex items-center justify-between gap-6 bg-transparent text-white pl-8 pr-2 py-2 border border-[#c49250]/40 rounded text-xs font-medium uppercase tracking-widest transition-all hover:border-[#c49250] hover:bg-[#c49250]/10 ${isActive ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`}>
                    {slide.buttonText}
                    <span className="w-8 h-8 rounded-full bg-[#c49250] flex items-center justify-center text-[#051024] text-xs"><FaArrowRight /></span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => go(-1)} className="absolute top-1/2 -translate-y-1/2 left-5 z-20 w-12 h-12 md:w-10 md:h-10 rounded-full border border-[#c49250]/30 bg-[#051024]/50 backdrop-blur-sm text-[#c49250] text-sm flex items-center justify-center cursor-pointer hover:bg-[#c49250] hover:text-[#051024]"><FaAngleLeft /></button>
      <button type="button" onClick={() => go(1)} className="absolute top-1/2 -translate-y-1/2 right-5 z-20 w-12 h-12 md:w-10 md:h-10 rounded-full border border-[#c49250]/30 bg-[#051024]/50 backdrop-blur-sm text-[#c49250] text-sm flex items-center justify-center cursor-pointer hover:bg-[#c49250] hover:text-[#051024]"><FaAngleRight /></button>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1400px] h-full hidden lg:flex justify-between z-[3] pointer-events-none px-5">
        {[1, 2, 3, 4, 5].map((n) => (<div key={n} className="w-px h-full bg-white/5" />))}
      </div>
    </section>
  );
}

(LexoraHero1 as typeof LexoraHero1 & { editorFields: readonly string[] }).editorFields = ["slides"];
