"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Shield, HeartHandshake, Coffee } from "lucide-react";
import { Card3D } from "./Card3D";

import { SectionSeparator } from "./SectionSeparator";

export const StorySection: React.FC = () => {
  return (
    <section
      id="story"
      className="relative -mt-16 sm:-mt-24 z-20 text-[#263B2D] scroll-mt-20 overflow-x-clip"
    >
      {/* 
        Angled Background Surface:
        Clipped diagonally so the hero image underneath shows cleanly above this line.
      */}
      <div
        className="absolute inset-0 bg-[#FBF9F3] pointer-events-none"
        style={{ clipPath: "polygon(0 3.2vw, 100% 0, 100% 100%, 0 100%)" }}
      />

      {/* Background Subtle Ambiance */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[#8E9F89]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#B58A57]/10 rounded-full blur-3xl pointer-events-none" />

      {/* 
        Diagonal Ribbon Marquee:
        Centered exactly on the angled boundary, 100% unclipped.
      */}
      <div
        className="relative z-30 pointer-events-none select-none"
        style={{ marginTop: "calc(1.6vw - 20px)" }}
      >
        <SectionSeparator
          theme="forest"
          angle={-1.8}
          direction="left"
          items={[
            { text: "PEACEFUL SANCTUARY", icon: "crest" },
            { text: "MET CITY &bull; YAKUBPUR &bull; JHAJJAR", icon: "pin" },
            { text: "VERIFIED 24/7 CCTV SECURITY", icon: "shield" },
            { text: "PURE RO PURIFIED WATER", icon: "water" },
            { text: "FRESH DAILY TIFFIN MEALS", icon: "dining" },
            { text: "HIGH-SPEED FIBER WI-FI", icon: "wifi" },
            { text: "QUIET RESTFUL LIVING", icon: "sparkles" },
            { text: "ATTENTIVE OWNER CARE", icon: "care" },
          ]}
        />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 pt-20 sm:pt-28 pb-24 sm:pb-32">
        {/* Section Header */}
        <div className="max-w-3xl mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#5D7656]/20 bg-[#5D7656]/10 text-[#263B2D] text-[11px] font-sans tracking-[0.2em] uppercase font-semibold mb-4 shadow-sm">
            <span>01 &bull; The Ravinarayan Ethos</span>
          </div>
          <h2 className="font-serif text-[#1A2E20] text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-normal tracking-tight leading-[1.08]">
            Rooted in Natural Warmth, <br className="hidden sm:inline" />
            <span className="italic font-light">Designed for Restful Living</span>
          </h2>
        </div>

        {/* Asymmetric Editorial Composition */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Column: Architectural Photo with Card3D */}
          <div className="lg:col-span-6 relative">
            <Card3D maxTilt={6} depth={18}>
              <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white aspect-[4/5] max-w-md mx-auto lg:max-w-none group bg-white">
                <Image
                  src="/gallery/stairs.jpg"
                  alt="Ravinarayan Guesthouse Architectural Stairway & Clean Interiors"
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute bottom-6 left-6 right-6 text-white">
                  <span className="text-[10px] tracking-widest uppercase font-mono text-[#DCE5D7] bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/15">
                    Clean Architecture
                  </span>
                  <p className="font-serif text-lg font-medium mt-2 text-white/95">
                    Maintained with quiet care and daily housekeeping
                  </p>
                </div>
              </div>
            </Card3D>

            {/* Overlapping Floating Inset Card — Deep Botanical High Contrast */}
            <div className="hidden sm:block absolute -bottom-8 -right-4 sm:-right-8 w-64 sm:w-72 p-5 sm:p-6 rounded-2xl bg-[#1A2E20] text-white shadow-2xl border border-white/10 backdrop-blur-md">
              <div className="flex items-center gap-3 mb-2.5">
                <div className="p-2.5 rounded-xl bg-white/10 text-emerald-400 border border-white/10">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#A8B9A1] font-mono">Verified Safety</p>
                  <p className="font-serif font-bold text-sm text-white">24/7 CCTV &amp; Security</p>
                </div>
              </div>
              <p className="text-xs text-white/80 leading-relaxed font-light">
                Quiet residential standards ensuring security and restful sleep for working professionals and scholars.
              </p>
            </div>
          </div>

          {/* Right Column: Editorial Narrative & Pillars */}
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <p className="font-serif text-2xl sm:text-3xl text-[#1A2E20] font-normal italic leading-snug">
              &ldquo;When you step away from the fast pace of daily work, your residence must be an oasis of quiet order, clean water, and nourishing food.&rdquo;
            </p>

            <div className="space-y-4 text-[#4A584E] text-base sm:text-lg leading-relaxed font-light">
              <p>
                At <strong className="text-[#1A2E20] font-semibold">Ravinarayan PG Guesthouse</strong>, we reimagined accommodation in the Met City and Yakubpur industrial area. We believe that affordability should never compromise cleanliness, security, or human dignity.
              </p>
              <p>
                Whether you are an engineer or corporate professional stationed in Met City, or a scholar in Jhajjar, our property offers spacious single and sharing rooms paired with dedicated laundry and pure RO drinking water.
              </p>
            </div>

            {/* Micro Feature Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              <div className="p-4 rounded-2xl bg-white border border-[#8E9F89]/20 shadow-sm flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[#5D7656]/10 flex items-center justify-center shrink-0 text-[#263B2D]">
                  <HeartHandshake className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-[#1A2E20] text-base">Attentive Care</h4>
                  <p className="text-xs text-[#5E715C] leading-relaxed font-light mt-0.5">Direct owner oversight ensures questions and facility needs are addressed promptly.</p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-[#8E9F89]/20 shadow-sm flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[#5D7656]/10 flex items-center justify-center shrink-0 text-[#263B2D]">
                  <Coffee className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-[#1A2E20] text-base">Wholesome Living</h4>
                  <p className="text-xs text-[#5E715C] leading-relaxed font-light mt-0.5">Fresh homemade tiffin meals delivered punctually to fuel your ambitious days.</p>
                </div>
              </div>
            </div>

            {/* Read More Link — High-Contrast Cabana Pill */}
            <div className="pt-4">
              <Link
                href="/about"
                className="inline-flex items-center gap-3 px-7 py-3.5 rounded-full bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-semibold tracking-wide transition-all duration-300 shadow-md hover:shadow-xl hover:-translate-y-0.5 group"
              >
                <span>Read Our Full Story &amp; Principles</span>
                <div className="w-6 h-6 rounded-full bg-white text-[#1A2E20] flex items-center justify-center group-hover:scale-105 transition-transform">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
