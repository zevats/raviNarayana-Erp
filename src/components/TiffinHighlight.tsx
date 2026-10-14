"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Utensils, Clock, MapPin, CheckCircle, ArrowUpRight, Phone, MessageSquare } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export const TiffinHighlight: React.FC = () => {
  const mealTimes = [
    { name: "Breakfast", note: "Wholesome, energizing start to your morning work shift" },
    { name: "Lunch", note: "Hot, balanced rotis, sabzi, and lentils prepared fresh" },
    { name: "Dinner", note: "Light, comforting home-style dinner to unwind peacefully" },
  ];

  return (
    <section id="tiffin" className="relative py-24 sm:py-32 bg-[#0E241D] text-ivory overflow-hidden">
      {/* Background Lighting */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-brass/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-10 w-80 h-80 bg-sage/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Column: Authentic Photography & Delivery Badge */}
          <div className="lg:col-span-6 relative">
            <div className="relative rounded-3xl overflow-hidden border-2 border-brass/30 shadow-2xl bg-forest-dark aspect-[4/3] sm:aspect-[16/11]">
              <Image
                src="/gallery/tiffin.png"
                alt="Ravinarayan Fresh Homemade Tiffin Service Meal"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover transition-transform duration-700 hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

              {/* Delivery Locations Pill */}
              <div className="absolute bottom-6 left-6 right-6 p-4 rounded-2xl bg-forest-dark/90 backdrop-blur-md border border-brass/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-brass/20 text-brass">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-mono tracking-widest text-sage">Service Coverage</p>
                    <p className="font-serif text-sm sm:text-base font-bold text-ivory">Met City &bull; Yakubpur &bull; Jhajjar</p>
                  </div>
                </div>
                <span className="hidden sm:inline-block px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-mono">
                  Daily Delivery
                </span>
              </div>
            </div>

            {/* Overlapping Floating Metric */}
            <div className="hidden sm:flex absolute -top-6 -right-6 p-4 rounded-2xl bg-forest border border-sage/30 shadow-xl items-center gap-3 backdrop-blur-md">
              <Utensils className="w-6 h-6 text-brass" />
              <div>
                <p className="text-xs uppercase tracking-wider text-sage font-mono">Pure Goodness</p>
                <p className="font-serif font-bold text-sm text-ivory">Hygienic Home Cooking</p>
              </div>
            </div>
          </div>

          {/* Right Column: Culinary Narrative & Actions */}
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 text-sage text-xs font-semibold tracking-widest uppercase mb-4">
              <span className="w-8 h-px bg-brass" />
              <span>04 &bull; Home-Style Dining</span>
            </div>

            <h2 className="headline-display font-serif font-bold text-ivory tracking-tight mb-6">
              Missing Home Food? <br />
              <span className="italic font-normal text-cream">Fresh, Hygienic Tiffin Service.</span>
            </h2>

            <p className="text-base text-cream/90 leading-relaxed mb-8">
              At Ravinarayan, we understand that nothing replaces the comfort of wholesome, home-cooked food. Our dedicated kitchen prepares daily meals using fresh ingredients, clean filtered water, and traditional balanced recipes.
            </p>

            {/* Meal Times Breakdown */}
            <div className="space-y-3 mb-8">
              {mealTimes.map((meal) => (
                <div
                  key={meal.name}
                  className="flex items-start gap-3.5 p-3.5 rounded-xl bg-forest/40 border border-sage/15"
                >
                  <CheckCircle className="w-5 h-5 text-brass shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-serif text-base font-bold text-ivory">{meal.name}</h4>
                    <p className="text-xs text-cream/70 leading-relaxed">{meal.note}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <a
                href={siteConfig.tiffinPortalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-brass hover:bg-brass-light text-forest-dark font-bold text-xs tracking-wider uppercase transition-all shadow-lg"
              >
                <span>Visit Tiffin Portal</span>
                <ArrowUpRight className="w-4 h-4" />
              </a>

              <a
                href={`https://wa.me/918571801102?text=${encodeURIComponent(
                  "Hello Ravinarayan Team, I would like to inquire about daily tiffin service in Met City / Yakubpur / Jhajjar."
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-xs tracking-wider uppercase transition-all shadow-md"
              >
                <MessageSquare className="w-4 h-4" />
                <span>WhatsApp Meal Enquiry</span>
              </a>

              <Link
                href="/tiffin-service"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-3.5 text-sage hover:text-ivory text-xs font-semibold tracking-wider uppercase transition-colors"
              >
                <span>View Full Details</span>
                <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
