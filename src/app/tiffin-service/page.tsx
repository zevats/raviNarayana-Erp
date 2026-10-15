"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { RoomModal } from "@/components/RoomModal";
import {
  UtensilsCrossed,
  Clock,
  MapPin,
  CheckCircle2,
  ArrowUpRight,
  Phone,
  MessageSquare,
  ShieldCheck,
  Droplets,
  Sparkles,
  Flame,
  Building2,
} from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export default function TiffinServicePage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <main className="min-h-screen flex flex-col bg-[#FAF8F5]">
      <Navbar onOpenEnquiry={() => setIsModalOpen(true)} />

      {/* Header Banner */}
      <section className="relative pt-36 pb-20 sm:pb-24 bg-[#16221A] text-white overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/gallery/tiffin.png"
            alt="Ravinarayan Tiffin Service"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#16221A] via-[#16221A]/80 to-black/70" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-5 shadow-sm">
              <span>CULINARY SERVICES</span>
            </div>
            <h1 className="font-serif text-white tracking-tight font-normal text-4xl sm:text-6xl md:text-7xl leading-[1.08] mb-4">
              Fresh, Wholesome &amp; <br className="hidden sm:inline" />
              <span className="italic font-light text-white/95">Home-Style Tiffin Service</span>
            </h1>
            <p className="text-base sm:text-lg text-white/85 font-light leading-relaxed mb-8">
              Prepared daily in a clean, hygienic kitchen using RO filtered water. Serving daily meals to students, corporate executives, and industrial staff across Met City, Yakubpur, and Jhajjar.
            </p>

            <div className="flex flex-wrap gap-4">
              <a
                href={siteConfig.tiffinPortalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-white hover:bg-white/95 text-[#1A2E20] font-semibold text-xs sm:text-sm tracking-wide transition-all shadow-xl group"
              >
                <span>Visit Dedicated Tiffin Portal</span>
                <div className="w-6 h-6 rounded-full bg-[#1A2E20] text-white flex items-center justify-center group-hover:scale-105 transition-transform">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </div>
              </a>

              <a
                href={`tel:${siteConfig.phoneRaw}`}
                className="inline-flex items-center gap-2 px-7 py-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-medium text-xs sm:text-sm tracking-wide transition-all"
              >
                <Phone className="w-4 h-4 text-emerald-400" />
                <span>Call to Order: {siteConfig.phone}</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Main Narrative & Meal Timings */}
      <section className="py-20 sm:py-24 bg-[#FBF9F3] text-[#263B2D]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            {/* Visual Photography Presentation */}
            <div className="lg:col-span-6 relative">
              <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white aspect-[4/3] bg-white">
                <Image
                  src="/gallery/tiffin.png"
                  alt="Authentic Tiffin Presentation"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              </div>

              <div className="mt-6 p-6 rounded-3xl bg-white border border-[#8E9F89]/20 shadow-md">
                <div className="flex items-center gap-3 mb-2">
                  <MapPin className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-serif font-medium text-[#1A2E20] text-base">Service Delivery Coverage</h3>
                </div>
                <p className="text-xs text-[#5E715C] leading-relaxed font-light">
                  Daily meal supply covering industrial plots, hostels, private residences, and office complexes in Met City, Yakubpur, and Jhajjar city limits.
                </p>
              </div>
            </div>

            {/* Content & Quality Commitments */}
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#5D7656]/20 bg-[#5D7656]/10 text-[#263B2D] text-[11px] font-sans tracking-[0.2em] uppercase font-semibold">
                <span>OUR CULINARY PROMISE</span>
              </div>
              <h2 className="font-serif text-[#1A2E20] text-3xl sm:text-4xl md:text-5xl font-normal tracking-tight leading-[1.08]">
                Nourishing Food, <br className="hidden sm:inline" />
                <span className="italic font-light">Cooked Like Home</span>
              </h2>

              <p className="text-[#4A584E] text-base leading-relaxed font-light">
                Eating outside every day can easily affect health and energy levels. That is why our kitchen adheres to strict hygienic preparation standards: daily fresh vegetables, pure spices, minimal oil, and food prepared strictly with RO filtered water.
              </p>

              {/* 3 Meal Schedule Breakdown */}
              <div className="space-y-3 pt-2">
                <div className="p-4 rounded-2xl bg-white border border-[#8E9F89]/20 shadow-sm flex items-start gap-3.5">
                  <Clock className="w-5 h-5 text-[#1A2E20] shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-serif font-medium text-[#1A2E20] text-base">Breakfast &bull; 7:30 AM – 9:30 AM</h4>
                    <p className="text-xs text-[#5E715C] leading-relaxed font-light">Freshly made hot rotis/parathas, wholesome tea/accompaniments to start your shift energized.</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-[#8E9F89]/20 shadow-sm flex items-start gap-3.5">
                  <Clock className="w-5 h-5 text-[#1A2E20] shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-serif font-medium text-[#1A2E20] text-base">Lunch &bull; 12:30 PM – 2:30 PM</h4>
                    <p className="text-xs text-[#5E715C] leading-relaxed font-light">Complete thali with fresh rotis, seasonal green vegetable, dal/lentils, rice, and fresh salad.</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-[#8E9F89]/20 shadow-sm flex items-start gap-3.5">
                  <Clock className="w-5 h-5 text-[#1A2E20] shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-serif font-medium text-[#1A2E20] text-base">Dinner &bull; 7:30 PM – 9:30 PM</h4>
                    <p className="text-xs text-[#5E715C] leading-relaxed font-light">Light, comforting home-cooked meal designed for smooth digestion and restorative sleep.</p>
                  </div>
                </div>
              </div>

              {/* Direct Booking CTA */}
              <div className="pt-4 flex flex-wrap gap-4">
                <a
                  href={`https://wa.me/918571801102?text=${encodeURIComponent(
                    "Hello Ravinarayan Team, I would like to subscribe to your daily tiffin service in Met City / Yakubpur / Jhajjar."
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white font-medium text-xs tracking-wide uppercase transition-all shadow-md"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Order on WhatsApp</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Kitchen Standards & Corporate Subscriptions (Theme: Deep Botanical Green) */}
      <section className="py-20 sm:py-24 bg-[#16221A] text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#5D7656]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-4 shadow-xs">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>HYGIENIC PREPARATION STANDARDS</span>
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-normal text-white tracking-tight leading-[1.08]">
              Pure Ingredients, <br />
              <span className="italic font-light text-[#C89F6B]">Restorative Daily Nourishment</span>
            </h2>
            <p className="mt-3 text-white/75 text-sm sm:text-base leading-relaxed font-light">
              We prepare every batch with the utmost respect for hygiene, digestive comfort, and genuine nutrition.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto mb-14">
            <div className="p-7 rounded-3xl bg-white/5 border border-white/10 space-y-3 hover:border-white/20 transition-all backdrop-blur-xs">
              <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Droplets className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-white">100% RO Filtered Cooking</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                All lentils, gravies, vegetables, and rice are washed and boiled strictly with pure RO water.
              </p>
            </div>

            <div className="p-7 rounded-3xl bg-white/5 border border-white/10 space-y-3 hover:border-white/20 transition-all backdrop-blur-xs">
              <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-white">Daily Fresh Sourcing</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                Seasonal farm-fresh vegetables procured daily from local Mandis. Zero stale or frozen ingredients.
              </p>
            </div>

            <div className="p-7 rounded-3xl bg-white/5 border border-white/10 space-y-3 hover:border-white/20 transition-all backdrop-blur-xs">
              <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Flame className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-white">Zero Reused Oil</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                Light cooking with pure mustard oil and authentic ghee. Never heavy on soda or reused frying oils.
              </p>
            </div>

            <div className="p-7 rounded-3xl bg-white/5 border border-white/10 space-y-3 hover:border-white/20 transition-all backdrop-blur-xs">
              <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Building2 className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-white">Corporate &amp; Plant Supply</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                Punctual bulk lunch and dinner deliveries for industrial plants, offices, and colleges in Met City.
              </p>
            </div>
          </div>

          {/* Action Box */}
          <div className="p-8 rounded-3xl bg-white/10 border border-white/15 max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 backdrop-blur-md">
            <div>
              <h4 className="font-serif text-xl font-medium text-white">
                Looking for Corporate or Monthly Meal Plans?
              </h4>
              <p className="text-xs sm:text-sm text-white/75 font-light mt-1">
                Flexible subscriptions, trial meals, and scheduled deliveries across Met City &amp; Yakubpur.
              </p>
            </div>
            <a
              href={`https://wa.me/918571801102?text=${encodeURIComponent(
                "Hello Ravinarayan Team, I would like to inquire about monthly meal plans and corporate tiffin delivery."
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full bg-white hover:bg-white/95 text-[#1A2E20] font-semibold text-xs tracking-wide uppercase transition-all shadow-lg"
            >
              <MessageSquare className="w-4 h-4 text-emerald-700" />
              <span>Inquire on WhatsApp</span>
            </a>
          </div>
        </div>
      </section>

      <Footer />

      <RoomModal
        room={null}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </main>
  );
}
