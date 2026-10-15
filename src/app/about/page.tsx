"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { RoomModal } from "@/components/RoomModal";
import { Shield, MapPin, ArrowUpRight, Sparkles, Moon, UtensilsCrossed, UserCheck } from "lucide-react";

export default function AboutPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <main className="min-h-screen flex flex-col bg-[#FAF8F5]">
      <Navbar onOpenEnquiry={() => setIsModalOpen(true)} />

      {/* About Hero Banner */}
      <section className="relative pt-36 pb-20 sm:pb-24 bg-[#16221A] text-white overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/hero-bg.jpg"
            alt="Ravinarayan Interior Atmosphere"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#16221A] via-[#16221A]/80 to-black/70" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-5 shadow-sm">
              <span>ABOUT RAVINARAYAN</span>
            </div>
            <h1 className="font-serif text-white tracking-tight font-normal text-4xl sm:text-6xl md:text-7xl leading-[1.08] mb-6">
              A Sanctuary of Order, <br className="hidden sm:inline" />
              <span className="italic font-light text-white/95">Safety, and Warmth</span>
            </h1>
            <p className="text-base sm:text-xl text-white/85 leading-relaxed font-light">
              Ravinarayan was established with a single foundational vision: to provide working professionals and students in Met City, Yakubpur, and Jhajjar with a home environment they genuinely look forward to returning to every single day.
            </p>
          </div>
        </div>
      </section>

      {/* Narrative Section with Asymmetric Imagery */}
      <section className="py-20 sm:py-24 bg-[#FBF9F3] text-[#263B2D]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#5D7656]/20 bg-[#5D7656]/10 text-[#263B2D] text-[11px] font-sans tracking-[0.2em] uppercase font-semibold">
                <span>OUR HERITAGE &amp; PURPOSE</span>
              </div>
              <h2 className="font-serif text-[#1A2E20] text-3xl sm:text-4xl md:text-5xl font-normal tracking-tight leading-[1.08]">
                Reframing Co-Living in <br className="hidden sm:inline" />
                <span className="italic font-light">Haryana&apos;s Industrial Corridor</span>
              </h2>
              <div className="space-y-4 text-[#4A584E] text-base leading-relaxed font-light">
                <p>
                  Met City and Yakubpur represent one of Haryana&apos;s most dynamic and fast-expanding industrial centers. Hundreds of ambitious engineers, corporate officers, plant supervisors, and diligent students arrive here every month.
                </p>
                <p>
                  Yet, finding living quarters that honor high cleanliness standards, quiet surroundings, reliable high-speed internet, and home-cooked meals has historically been challenging.
                </p>
                <p>
                  At <strong className="text-[#1A2E20] font-semibold">Ravinarayan PG Guesthouse</strong>, we set out to build an intentional alternative: combining the calm aesthetics of a boutique retreat with the affordability and practicality of everyday student and professional accommodation.
                </p>
              </div>

              <div className="pt-4 flex flex-wrap gap-4">
                <div className="p-4 rounded-2xl bg-white border border-[#8E9F89]/20 shadow-sm flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-emerald-600" />
                  <span className="text-xs font-semibold text-[#1A2E20]">Met City &bull; Yakubpur &bull; Jhajjar</span>
                </div>
                <div className="p-4 rounded-2xl bg-white border border-[#8E9F89]/20 shadow-sm flex items-center gap-3">
                  <Shield className="w-5 h-5 text-emerald-600" />
                  <span className="text-xs font-semibold text-[#1A2E20]">24/7 Monitored Premises</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 grid grid-cols-2 gap-4">
              <div className="relative aspect-[3/4] rounded-3xl overflow-hidden shadow-xl border-4 border-white bg-white">
                <Image
                  src="/gallery/stairs.jpg"
                  alt="Ravinarayan Stairway & Modern Architecture"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 50vw, 25vw"
                />
              </div>
              <div className="relative aspect-[3/4] rounded-3xl overflow-hidden shadow-xl border-4 border-white translate-y-6 bg-white">
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
      <section className="py-20 sm:py-24 bg-[#16221A] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-4 shadow-sm">
              <span>OUR COMMITMENTS</span>
            </div>
            <h2 className="font-serif text-white text-3xl sm:text-4xl md:text-5xl font-normal tracking-tight leading-[1.08]">
              Our 4 Living Commitments
            </h2>
            <p className="mt-3 text-white/75 text-sm sm:text-base font-light">
              The fundamental standards that guide how we maintain our guesthouse and care for each resident.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-8 rounded-3xl bg-white/5 border border-white/10 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-xl font-medium text-white">Uncompromised Cleanliness</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                Regular housekeeping of corridors, stairways, and shared facilities, ensuring a fresh and hygienic atmosphere.
              </p>
            </div>

            <div className="p-8 rounded-3xl bg-white/5 border border-white/10 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Moon className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-xl font-medium text-white">Quiet &amp; Restful Nights</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                A community policy that respects nighttime silence so hard-working professionals and scholars can sleep soundly.
              </p>
            </div>

            <div className="p-8 rounded-3xl bg-white/5 border border-white/10 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <UtensilsCrossed className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-xl font-medium text-white">Wholesome Nutrition</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                Our in-house kitchen and tiffin service delivers hot, balanced vegetarian meals prepared with pure RO filtered water.
              </p>
            </div>

            <div className="p-8 rounded-3xl bg-white/5 border border-white/10 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <UserCheck className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-xl font-medium text-white">Direct Owner Care</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                No bureaucratic delays. Management is directly reachable for any maintenance, internet, or accommodation queries.
              </p>
            </div>
          </div>

          <div className="mt-16 text-center">
            <Link
              href="/rooms"
              className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-white hover:bg-white/95 text-[#1A2E20] font-semibold text-xs sm:text-sm tracking-wide transition-all shadow-xl group"
            >
              <span>Explore Available Rooms</span>
              <div className="w-6 h-6 rounded-full bg-[#1A2E20] text-white flex items-center justify-center group-hover:scale-105 transition-transform">
                <ArrowUpRight className="w-3.5 h-3.5" />
              </div>
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
