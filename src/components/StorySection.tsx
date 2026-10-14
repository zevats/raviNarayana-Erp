"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Shield, HeartHandshake, Sparkles, Coffee } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export const StorySection: React.FC = () => {
  return (
    <section id="story" className="relative py-24 sm:py-32 bg-cream text-charcoal overflow-hidden">
      {/* Subtle botanical watermark background decoration */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-sage/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-brass/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="max-w-3xl mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 text-forest text-xs font-semibold tracking-widest uppercase mb-4">
            <span className="w-8 h-px bg-brass" />
            <span>01 &bull; The Ravinarayan Ethos</span>
          </div>
          <h2 className="headline-display text-forest font-serif font-bold tracking-tight">
            Rooted in Natural Warmth, Designed for Restful Living.
          </h2>
        </div>

        {/* Asymmetric Editorial Composition */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Column: Multi-layer Image Composition */}
          <div className="lg:col-span-6 relative">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-white/80 aspect-[4/5] max-w-md mx-auto lg:max-w-none">
              <Image
                src="/gallery/stairs.jpg"
                alt="Ravinarayan Guesthouse Architectural Stairway & Clean Interiors"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover transition-transform duration-700 hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 text-white">
                <span className="text-[11px] tracking-widest uppercase font-mono text-sage">Clean Architecture</span>
                <p className="font-serif text-lg font-medium">Maintained with quiet care every day</p>
              </div>
            </div>

            {/* Overlapping Floating Inset Card */}
            <div className="hidden sm:block absolute -bottom-8 -right-4 sm:-right-8 w-60 sm:w-64 p-5 rounded-2xl bg-forest text-ivory shadow-2xl border border-brass/30 backdrop-blur-md">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-brass/20 text-brass">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-sage font-mono">Verified Safety</p>
                  <p className="font-serif font-bold text-sm">24/7 CCTV & Security</p>
                </div>
              </div>
              <p className="text-xs text-cream/70 leading-relaxed">
                Quiet residential standards ensuring security and restful sleep for everyone.
              </p>
            </div>
          </div>

          {/* Right Column: Editorial Narrative & Pillars */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            <p className="font-serif text-2xl sm:text-3xl text-forest font-medium italic leading-snug mb-6">
              &ldquo;When you step away from the fast pace of daily work, your residence must be an oasis of quiet order, clean water, and nourishing food.&rdquo;
            </p>

            <div className="space-y-4 text-muted text-base sm:text-lg leading-relaxed mb-8">
              <p>
                At <strong className="text-charcoal font-semibold">Ravinarayan PG Guesthouse</strong>, we reimagined accommodation in the Met City and Yakubpur industrial area. We believe that affordability should never compromise cleanliness, security, or human dignity.
              </p>
              <p>
                Whether you are an engineer or corporate professional stationed in Met City, or a student preparing for examinations in Jhajjar, our property offers spacious single and sharing rooms paired with dedicated laundry and pure RO drinking water.
              </p>
            </div>

            {/* Micro Feature List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6 border-t border-charcoal/10 mb-8">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-xl bg-forest/10 flex items-center justify-center shrink-0 text-forest">
                  <HeartHandshake className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-forest text-base">Attentive Care</h4>
                  <p className="text-xs text-muted leading-relaxed">Direct owner oversight ensures questions and facility needs are addressed promptly.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-xl bg-forest/10 flex items-center justify-center shrink-0 text-forest">
                  <Coffee className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-forest text-base">Wholesome Living</h4>
                  <p className="text-xs text-muted leading-relaxed">Fresh homemade tiffin meals delivered punctually to fuel your ambitious days.</p>
                </div>
              </div>
            </div>

            {/* Read More Link */}
            <div className="flex items-center gap-4">
              <Link
                href="/about"
                className="inline-flex items-center gap-2 font-medium text-forest hover:text-brass transition-colors text-sm font-semibold tracking-wide group"
              >
                <span>Read Our Full Story & Principles</span>
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
