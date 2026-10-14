"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
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
  Sparkles,
} from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export default function TiffinServicePage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <main className="min-h-screen flex flex-col bg-ivory">
      <Navbar onOpenEnquiry={() => setIsModalOpen(true)} />

      {/* Header Banner */}
      <section className="relative pt-36 pb-20 bg-[#0E241D] text-ivory overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/gallery/tiffin.png"
            alt="Ravinarayan Tiffin Service"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0E241D] via-[#0E241D]/80 to-black/70" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-forest-light border border-brass/30 text-brass text-xs font-mono uppercase tracking-wider mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Culinary Services</span>
            </div>
            <h1 className="headline-hero font-serif font-bold text-ivory tracking-tight mb-4">
              Fresh, Wholesome &amp; Home-Style Tiffin Service
            </h1>
            <p className="text-base sm:text-lg text-cream/90 font-light leading-relaxed mb-8">
              Prepared daily in a clean, hygienic kitchen using RO filtered water. Serving daily meals to students, corporate executives, and industrial staff across Met City, Yakubpur, and Jhajjar.
            </p>

            <div className="flex flex-wrap gap-4">
              <a
                href={siteConfig.tiffinPortalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-brass hover:bg-brass-light text-forest-dark font-bold text-xs tracking-wider uppercase transition-all shadow-lg"
              >
                <span>Visit Dedicated Tiffin Portal</span>
                <ArrowUpRight className="w-4 h-4" />
              </a>

              <a
                href={`tel:${siteConfig.phoneRaw}`}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-ivory font-semibold text-xs tracking-wider uppercase transition-all"
              >
                <Phone className="w-4 h-4 text-brass" />
                <span>Call to Order: {siteConfig.phone}</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Main Narrative & Meal Timings */}
      <section className="py-24 bg-cream text-charcoal">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            {/* Visual Photography Presentation */}
            <div className="lg:col-span-6 relative">
              <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white aspect-[4/3]">
                <Image
                  src="/gallery/tiffin.png"
                  alt="Authentic Tiffin Presentation"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              </div>

              <div className="mt-6 p-6 rounded-2xl bg-white border border-sage/20 shadow-md">
                <div className="flex items-center gap-3 mb-2">
                  <MapPin className="w-5 h-5 text-brass" />
                  <h3 className="font-serif font-bold text-forest text-base">Service Delivery Coverage</h3>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Daily meal drop-offs across industrial companies, warehouses, and residences throughout <strong className="text-charcoal">Met City</strong>, <strong className="text-charcoal">Yakubpur</strong>, and central <strong className="text-charcoal">Jhajjar, Haryana</strong>.
                </p>
              </div>
            </div>

            {/* Culinary Details */}
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 text-forest text-xs font-semibold tracking-widest uppercase">
                <span className="w-8 h-px bg-brass" />
                <span>Why Our Meals Stand Out</span>
              </div>
              <h2 className="headline-display font-serif font-bold text-forest tracking-tight">
                Crafted Like Mom&apos;s Kitchen, Delivered Right on Time.
              </h2>
              <div className="space-y-4 text-muted text-base leading-relaxed">
                <p>
                  Eating out continuously at roadside stalls or relying on oily commercial takeout quickly affects health, energy, and productivity.
                </p>
                <p>
                  Ravinarayan Tiffin Service was designed to offer the opposite: pure, home-style vegetarian cooking prepared with controlled spices, premium grains, and genuine hygiene.
                </p>
              </div>

              {/* Meal Breakdown Cards */}
              <div className="space-y-4 pt-4">
                <div className="p-4 rounded-2xl bg-white border border-sage/20 shadow-sm flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-forest/10 text-forest shrink-0">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-serif font-bold text-forest text-base">Breakfast Service</h4>
                    <p className="text-xs text-muted leading-relaxed">Fresh, hot morning preparations to power your early work shift or classes.</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-sage/20 shadow-sm flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-forest/10 text-forest shrink-0">
                    <UtensilsCrossed className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-serif font-bold text-forest text-base">Lunch Delivery</h4>
                    <p className="text-xs text-muted leading-relaxed">Punctually delivered to corporate plants, offices, and rooms across Met City and Yakubpur.</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-sage/20 shadow-sm flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-forest/10 text-forest shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-serif font-bold text-forest text-base">Dinner Service</h4>
                    <p className="text-xs text-muted leading-relaxed">Comforting, light, and nutritious home-style dinner to close your day well.</p>
                  </div>
                </div>
              </div>

              {/* Action */}
              <div className="pt-4 flex items-center gap-4">
                <a
                  href={`https://wa.me/918571801102?text=${encodeURIComponent(
                    "Hello Ravinarayan Team, I would like to subscribe to your tiffin service in Met City / Yakubpur / Jhajjar. Please share details."
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-xs tracking-wider uppercase transition-all shadow-md"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Inquire on WhatsApp</span>
                </a>
              </div>
            </div>
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
