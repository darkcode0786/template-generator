'use client';
import { mapThemeUploadAssetsInData } from "../../../lib/restaurantFoodAssets";
function mediaSrc(src?: string) {
  const t = String(src || "").trim();
  if (!t) return "";
  if (/^(https?:|data:|blob:)/i.test(t)) return t;
  return t.startsWith("/") ? t : `/${t}`;
}


import React, { useState } from 'react';

import { FiPlus, FiMinus } from 'react-icons/fi';
import { FaBalanceScale } from 'react-icons/fa';

export default function LexoraFaq1({ data = {} }: { data?: Record<string, any> }) {
  (() => { if (typeof document === "undefined") return; if (document.getElementById("theme-upload-css-vars")) return; const s = document.createElement("style"); s.id = "theme-upload-css-vars"; s.textContent = ":root{--color-primary:#0a1828;--color-accent:#c49250;--color-bg-light:#f8f9fa;--color-text:#333333;--color-text-light:#666666;--color-bg-main:#ffffff;}"; document.head.appendChild(s); })();
  data = mapThemeUploadAssetsInData(data);
  if (!data || typeof data !== "object") data = {};
  const [openId, setOpenId] = useState<string | null>('faq-1');

  if (!data || !data.items) return null;

  const toggleAccordion = (id: string) => {
    setOpenId(openId === id ? null : id);
  };

  // Split items into two columns
  const half = Math.ceil(data.items.length / 2);
  const leftColumn = data.items.slice(0, half);
  const rightColumn = data.items.slice(half);

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-8">
          <div className="flex items-center justify-center gap-4 mb-4">
            <span className="w-12 h-px bg-[var(--color-accent)]"></span>
            <span className="text-[var(--color-accent)] font-bold tracking-widest text-sm uppercase">
              {data.badge}
            </span>
            <span className="w-12 h-px bg-[var(--color-accent)]"></span>
          </div>
          
          <h2 className="text-4xl md:text-5xl font-bold text-[var(--color-primary)] mb-6">
            {data.highlightText ? (
              data.title.split(new RegExp(`(${data.highlightText})`, 'gi')).map((part, i) =>
                part.toLowerCase() === data.highlightText?.toLowerCase() ? (
                  <span key={i} className="text-[var(--color-accent)]">{part}</span>
                ) : (
                  part
                )
              )
            ) : (
              data.title
            )}
          </h2>
          
          <div className="flex justify-center mb-6">
            <FaBalanceScale className="text-[var(--color-accent)] text-2xl" />
          </div>
          
          <p className="text-gray-600 text-lg">
            {data.description}
          </p>
        </div>

        {/* Accordion Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-start">
          {/* Left Column */}
          <div className="flex flex-col gap-4">
            {leftColumn.map((item) => {
              const isOpen = openId === item.id;
              return (
                <div 
                  key={item.id} 
                  className={`border rounded-lg transition-all duration-300 ${
 isOpen 
 ? 'border-[#edeae1] bg-[#fdfaf5] border-l-4 border-l-[var(--color-accent)] shadow-sm' 
 : 'border-gray-200 bg-white hover:border-gray-300'
 }`}
                >
                  <button
                    onClick={() => toggleAccordion(item.id)}
                    className="w-full flex items-center justify-between p-5 md:p-6 text-left"
                  >
                    <span className="font-bold text-[var(--color-primary)] text-lg pr-4">
                      {item.question}
                    </span>
                    <span className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded ${isOpen ? 'bg-[#051024] text-white' : 'bg-[#051024] text-white'}`}>
                      {isOpen ? <FiMinus className="w-5 h-5" /> : <FiPlus className="w-5 h-5" />}
                    </span>
                  </button>
                  
                  {isOpen && (
                    <div className="px-5 md:px-6 pb-6 pt-2 text-gray-600 leading-relaxed text-[15px]">
                      {item.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-4">
            {rightColumn.map((item) => {
              const isOpen = openId === item.id;
              return (
                <div 
                  key={item.id} 
                  className={`border rounded-lg transition-all duration-300 ${
 isOpen 
 ? 'border-[#edeae1] bg-[#fdfaf5] border-l-4 border-l-[var(--color-accent)] shadow-sm' 
 : 'border-gray-200 bg-white hover:border-gray-300'
 }`}
                >
                  <button
                    onClick={() => toggleAccordion(item.id)}
                    className="w-full flex items-center justify-between p-5 md:p-6 text-left"
                  >
                    <span className="font-bold text-[var(--color-primary)] text-lg pr-4">
                      {item.question}
                    </span>
                    <span className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded ${isOpen ? 'bg-[#051024] text-white' : 'bg-[#051024] text-white'}`}>
                      {isOpen ? <FiMinus className="w-5 h-5" /> : <FiPlus className="w-5 h-5" />}
                    </span>
                  </button>
                  
                  {isOpen && (
                    <div className="px-5 md:px-6 pb-6 pt-2 text-gray-600 leading-relaxed text-[15px]">
                      {item.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

(LexoraFaq1 as typeof LexoraFaq1 & { editorFields: readonly string[] }).editorFields = ["badge","title","highlightText","description","items"];
