"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, ArrowUpRight, MessageSquare, MapPin } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export const TiffinHighlight: React.FC = () => {
  const mealSchedule = [
    { name: "Breakfast", detail: "Energizing, light morning meals delivered fresh" },
    { name: "Lunch", detail: "Wholesome rotis, seasonal sabzi, and dal prepared with RO water" },
    { name: "Dinner", detail: "Comforting home-style evening meals for a restful night" },
  ];

  return (
    <section id="tiffin" className="py-20 sm:py-28 bg-[#FAF8F5] text-[#263B2D] border-t border-[#8E9F89]/15">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Column: Authentic Food Photograph */}
          <div className="lg:col-span-6 relative">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white aspect-[4/3] bg-white group">
              <Image
                src="/gallery/tiffin.png"
                alt="Ravinarayan Fresh Daily Tiffin Meal"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 text-white flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <MapPin className="w-4 h-4 text-emerald-400" />
                  <span>Delivered in Met City, Yakubpur &amp; Jhajjar</span>
                </div>
                <span className="px-3 py-1 rounded-full bg-emerald-700/80 backdrop-blur-sm text-[10px] font-mono text-white">
                  Pure Vegetarian
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Editorial Text & Concise Inclusions */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#5D7656]/20 bg-[#5D7656]/10 text-[#263B2D] text-[11px] font-sans tracking-[0.2em] uppercase font-semibold shadow-sm">
              <span>HOMEMADE DINING</span>
            </div>

            <h2 className="font-serif text-[#1A2E20] text-3xl sm:text-4xl md:text-5xl font-normal tracking-tight leading-[1.1]">
              Fresh Food. <br />
              <span className="italic font-light">Everyday Comfort.</span>
            </h2>

            <p className="text-[#4A584E] text-base sm:text-lg leading-relaxed font-light">
              Nutritious, home-style North Indian meals cooked daily with fresh ingredients, low oil, and clean RO purified water. Available for residents and workplace deliveries.
            </p>

            {/* Meal Times List */}
            <div className="space-y-3 pt-1 pb-2">
              {mealSchedule.map((meal) => (
                <div
                  key={meal.name}
                  className="flex items-start gap-3 p-3.5 rounded-2xl bg-white border border-[#8E9F89]/20 shadow-sm"
                >
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-serif text-base font-semibold text-[#1A2E20]">
                      {meal.name}
                    </h4>
                    <p className="text-xs text-[#5E715C] font-light leading-relaxed">
                      {meal.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                href="/tiffin-service"
                className="inline-flex items-center gap-3 px-7 py-3.5 rounded-full bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-semibold tracking-wide transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 group"
              >
                <span>Explore Tiffin Service</span>
                <div className="w-6 h-6 rounded-full bg-white text-[#1A2E20] flex items-center justify-center group-hover:scale-105 transition-transform">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </div>
              </Link>

              <a
                href={siteConfig.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full border border-emerald-600/30 bg-white hover:bg-emerald-50 text-[#1A2E20] text-xs sm:text-sm font-medium tracking-wide transition-all shadow-sm hover:shadow"
              >
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                <span>Enquire on WhatsApp</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
