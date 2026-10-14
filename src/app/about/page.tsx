"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { RoomModal } from "@/components/RoomModal";
import { Shield, Sparkles, HeartHandshake, Eye, MapPin, CheckCircle, ArrowRight } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export default function AboutPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <main className="min-h-screen flex flex-col bg-ivory">
      <Navbar onOpenEnquiry={() => setIsModalOpen(true)} />

      {/* About Hero */}
      <section className="relative pt-36 pb-20 bg-deep text-ivory overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/hero-bg.jpg"
            alt="Ravinarayan Interior Atmosphere"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-deep via-deep/80 to-black/70" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-forest-light border border-brass/30 text-brass text-xs font-mono uppercase tracking-wider mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              <span>About Ravinarayan</span>
            </div>
            <h1 className="headline-hero font-serif font-bold text-ivory tracking-tight mb-6">
              A Sanctuary of Order, Safety, and Warmth.
            </h1>
            <p className="text-base sm:text-xl text-cream/90 leading-relaxed font-light">
              Ravinarayan was established with a single foundational vision: to provide working professionals and students in Met City, Yakubpur, and Jhajjar with a home environment they genuinely look forward to returning to every single day.
            </p>
          </div>
        </div>
      </section>

      {/* Narrative Section with Asymmetric Imagery */}
      <section className="py-24 bg-cream text-charcoal">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 text-forest text-xs font-semibold tracking-widest uppercase">
                <span className="w-8 h-px bg-brass" />
                <span>Our Heritage &amp; Purpose</span>
              </div>
              <h2 className="headline-display font-serif font-bold text-forest tracking-tight">
                Reframing Co-Living in Haryana&apos;s Industrial Corridor
              </h2>
              <div className="space-y-4 text-muted text-base leading-relaxed">
                <p>
                  Met City and Yakubpur represent one of Haryana&apos;s most dynamic and fast-expanding industrial centers. Hundreds of ambitious engineers, corporate officers, plant supervisors, and diligent students arrive here every month.
                </p>
                <p>
                  Yet, finding living quarters that honor high cleanliness standards, quiet surroundings, reliable high-speed internet, and home-cooked meals has historically been challenging.
                </p>
                <p>
                  At <strong className="text-charcoal font-semibold">Ravinarayan PG Guesthouse</strong>, we set out to build an intentional alternative: combining the calm aesthetics of a boutique retreat with the affordability and practicality of everyday student and professional accommodation.
                </p>
              </div>

              <div className="pt-4 flex flex-wrap gap-4">
                <div className="p-4 rounded-xl bg-white border border-sage/20 shadow-sm flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-brass" />
                  <span className="text-xs font-semibold text-forest">Met City &bull; Yakubpur &bull; Jhajjar</span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-sage/20 shadow-sm flex items-center gap-3">
                  <Shield className="w-5 h-5 text-brass" />
                  <span className="text-xs font-semibold text-forest">24/7 Monitored Premises</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 grid grid-cols-2 gap-4">
              <div className="relative aspect-[3/4] rounded-2xl overflow-hidden shadow-xl border-2 border-white">
                <Image
                  src="/gallery/stairs.jpg"
                  alt="Ravinarayan Stairway & Modern Architecture"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 50vw, 25vw"
                />
              </div>
              <div className="relative aspect-[3/4] rounded-2xl overflow-hidden shadow-xl border-2 border-white translate-y-6">
                <Image
                  src="/gallery/room-1.jpg"
                  alt="Ravinarayan Room Interior"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 50vw, 25vw"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Values Section */}
      <section className="py-24 bg-forest text-ivory">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="headline-display font-serif font-bold text-ivory tracking-tight">
              Our 4 Living Commitments
            </h2>
            <p className="mt-3 text-cream/80 text-sm sm:text-base">
              The fundamental standards that guide how we maintain our guesthouse and care for each resident.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-8 rounded-2xl bg-[#102A22] border border-sage/20 space-y-4">
              <span className="font-mono text-2xl font-bold text-brass">01</span>
              <h3 className="font-serif text-xl font-bold text-ivory">Uncompromised Cleanliness</h3>
              <p className="text-xs text-cream/70 leading-relaxed">
                Regular housekeeping of corridors, stairways, and shared facilities, ensuring a fresh and hygienic atmosphere.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-[#102A22] border border-sage/20 space-y-4">
              <span className="font-mono text-2xl font-bold text-brass">02</span>
              <h3 className="font-serif text-xl font-bold text-ivory">Quiet &amp; Restful Nights</h3>
              <p className="text-xs text-cream/70 leading-relaxed">
                A community policy that respects nighttime silence so hard-working professionals and students can sleep soundly.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-[#102A22] border border-sage/20 space-y-4">
              <span className="font-mono text-2xl font-bold text-brass">03</span>
              <h3 className="font-serif text-xl font-bold text-ivory">Wholesome Nutrition</h3>
              <p className="text-xs text-cream/70 leading-relaxed">
                Our in-house kitchen and tiffin service delivers hot, balanced vegetarian meals prepared with pure RO filtered water.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-[#102A22] border border-sage/20 space-y-4">
              <span className="font-mono text-2xl font-bold text-brass">04</span>
              <h3 className="font-serif text-xl font-bold text-ivory">Direct Owner Care</h3>
              <p className="text-xs text-cream/70 leading-relaxed">
                No bureaucratic delays. Management is directly reachable for any maintenance, internet, or accommodation queries.
              </p>
            </div>
          </div>

          <div className="mt-16 text-center">
            <Link
              href="/rooms"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-brass hover:bg-brass-light text-forest-dark font-bold text-xs tracking-wider uppercase transition-all shadow-xl"
            >
              <span>Explore Available Rooms</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
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
