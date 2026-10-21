"use client";
import { mapThemeUploadAssetsInData } from "../../../lib/restaurantFoodAssets";
function mediaSrc(src?: string) {
  const t = String(src || "").trim();
  if (!t) return "";
  if (/^(https?:|data:|blob:)/i.test(t)) return t;
  return t.startsWith("/") ? t : `/${t}`;
}

import React from 'react';

import { FaClock, FaFacebookF, FaInstagram, FaLinkedinIn, FaMapMarkerAlt, FaPhoneAlt } from 'react-icons/fa';
import { FaXTwitter } from 'react-icons/fa6';

const renderIcon = (iconName: string) => {
  switch (iconName) {
    case 'FaFacebookF':  return <FaFacebookF />;
    case 'FaTwitter':    return <FaXTwitter />;
    case 'FaLinkedinIn': return <FaLinkedinIn />;
    case 'FaInstagram':  return <FaInstagram />;
    default:             return null;
  }
};

export default function LexoraTopBar1({ data = {} }: { data?: Record<string, any> }) {
  (() => { if (typeof document === "undefined") return; if (document.getElementById("theme-upload-css-vars")) return; const s = document.createElement("style"); s.id = "theme-upload-css-vars"; s.textContent = ":root{--color-primary:#0a1828;--color-accent:#c49250;--color-bg-light:#f8f9fa;--color-text:#333333;--color-text-light:#666666;--color-bg-main:#ffffff;}"; document.head.appendChild(s); })();
  data = mapThemeUploadAssetsInData(data);
  if (!data || typeof data !== "object") data = {};
  if (!data || typeof data !== 'object') data = {};

  return (
    <div className="hidden lg:flex w-full bg-[#051024] border-b border-white/5 text-white text-[13px]">
      <div className="w-full max-w-[1250px] mx-auto px-6 flex items-center justify-between py-2.5">

        {/* Left — Info Items */}
        <div className="flex items-center gap-6">

          {/* Working Hours */}
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-[28px] h-[28px] rounded-full border border-[#c49250] text-[#c49250] text-[11px]">
              <FaClock />
            </span>
            <span className="text-white/80 font-normal">{data.workingHours}</span>
          </div>

          <span className="text-white/15 select-none">|</span>

          {/* Phone */}
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-[28px] h-[28px] rounded-full border border-[#c49250] text-[#c49250] text-[11px]">
              <FaPhoneAlt />
            </span>
            <span className="text-white/80 font-normal">{data.phone}</span>
          </div>

          <span className="text-white/15 select-none">|</span>

          {/* Address */}
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-[28px] h-[28px] rounded-full border border-[#c49250] text-[#c49250] text-[11px]">
              <FaMapMarkerAlt />
            </span>
            <span className="text-white/80 font-normal">{data.address}</span>
          </div>

        </div>

        {/* Right — Social Links */}
        <div className="flex items-center gap-2">
          {data.socialLinks.map((link) => (
            <a
              key={link.platform}
              href={link.url}
              className="flex items-center justify-center w-[28px] h-[28px] rounded-full border border-white/25 text-white text-[11px] transition-all duration-300 hover:border-[#c49250] hover:bg-[#c49250] hover:text-[#051024]"
            >
              {renderIcon(link.icon)}
            </a>
          ))}
        </div>

      </div>
    </div>
  );
};

(LexoraTopBar1 as typeof LexoraTopBar1 & { editorFields: readonly string[] }).editorFields = ["address","phone","workingHours","socialLinks"];
