"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { RoomModal } from "@/components/RoomModal";
import { roomsData, RoomCategory } from "@/data/roomsData";
import { Check, ArrowUpRight, Filter, Phone, MessageSquare, Info } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export default function RoomsPage() {
  const [selectedFilter, setSelectedFilter] = useState("All");
  const [activeModalRoom, setActiveModalRoom] = useState<RoomCategory | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const filters = ["All", "Single", "Double", "Suite", "Shared"];

  const filtered = roomsData.filter((r) => {
    if (selectedFilter === "All") return true;
    return r.occupancyType === selectedFilter;
  });

  const handleEnquire = (room: RoomCategory) => {
    setActiveModalRoom(room);
    setIsModalOpen(true);
  };

  return (
    <main className="min-h-screen flex flex-col bg-[#FAF8F5]">
      <Navbar onOpenEnquiry={() => { setActiveModalRoom(roomsData[0]); setIsModalOpen(true); }} />

      {/* Header Banner */}
      <section className="relative pt-36 pb-20 sm:pb-24 bg-[#16221A] text-white overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/hero-bg.jpg"
            alt="Ravinarayan Rooms"
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
              <span>LIVING SPACES</span>
            </div>
            <h1 className="font-serif text-white tracking-tight font-normal text-4xl sm:text-6xl md:text-7xl leading-[1.08] mb-4">
              Accommodations Designed <br className="hidden sm:inline" />
              <span className="italic font-light text-white/95">for Tranquility</span>
            </h1>
            <p className="text-base sm:text-lg text-white/85 font-light leading-relaxed">
              Explore our 8 curated accommodation formats in Met City, Yakubpur, and Jhajjar. Each room category provides high-speed Wi-Fi, pure RO water, CCTV safety, and optional home-style meal service.
            </p>
          </div>
        </div>
      </section>

      {/* Rooms Showcase Section */}
      <section className="py-20 sm:py-24 bg-[#FAF8F5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-8 mb-12 border-b border-[#8E9F89]/20 gap-4">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
              <span className="text-xs uppercase tracking-wider text-[#5E715C] font-mono mr-2 flex items-center gap-1 font-semibold">
                <Filter className="w-3.5 h-3.5" /> Filter Category:
              </span>
              {filters.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setSelectedFilter(f)}
                  className={`px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition-all ${
                    selectedFilter === f
                      ? "bg-[#1A2E20] text-white shadow-md"
                      : "bg-white text-[#4A584E] hover:text-[#1A2E20] border border-[#8E9F89]/25 shadow-sm"
                  }`}
                >
                  {f} {f === "All" ? `(${roomsData.length})` : ""}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <a
                href={`tel:${siteConfig.phoneRaw}`}
                className="inline-flex items-center gap-2 text-xs font-semibold text-[#1A2E20] hover:text-[#5D7656] transition-colors"
              >
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                <span>Call {siteConfig.phone}</span>
              </a>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filtered.map((room) => (
              <div
                key={room.id}
                className="group flex flex-col rounded-3xl bg-white border border-[#8E9F89]/20 shadow-md hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 overflow-hidden"
              >
                {/* Image */}
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#EAE5D9]">
                  <Image
                    src={room.image}
                    alt={room.name}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <span className="absolute top-4 left-4 px-3 py-1 rounded-full bg-white/95 backdrop-blur-md border border-[#8E9F89]/30 text-[#1A2E20] text-[10px] font-sans font-semibold tracking-wider uppercase shadow-sm">
                    {room.occupancyType} Room
                  </span>
                </div>

                {/* Details */}
                <div className="p-7 flex-1 flex flex-col justify-between space-y-6">
                  <div>
                    <h2 className="font-serif text-2xl font-medium text-[#1A2E20] group-hover:text-[#5D7656] transition-colors mb-1.5">
                      {room.name}
                    </h2>
                    <p className="font-serif italic text-[#5E715C] text-sm mb-3">
                      &ldquo;{room.tagline}&rdquo;
                    </p>
                    <p className="text-sm text-[#4A584E] leading-relaxed mb-6 font-light">
                      {room.description}
                    </p>

                    <div className="space-y-2 pt-4 border-t border-[#8E9F89]/20">
                      <p className="text-[11px] uppercase tracking-wider text-[#1A2E20] font-mono font-semibold">Key Inclusions</p>
                      <div className="grid grid-cols-2 gap-2">
                        {room.highlights.map((h) => (
                          <div key={h} className="flex items-center gap-1.5 text-xs text-[#263B2D]">
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">{h}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[#8E9F89]/20 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleEnquire(room)}
                      className="flex-1 py-3 px-4 rounded-full bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold tracking-wide transition-all duration-300 flex items-center justify-between shadow-md hover:shadow-lg group/btn"
                    >
                      <span>Check Vacancy</span>
                      <div className="w-6 h-6 rounded-full bg-white text-[#1A2E20] flex items-center justify-center group-hover/btn:scale-105 transition-transform">
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </div>
                    </button>
                    <a
                      href={`https://wa.me/918571801102?text=${encodeURIComponent(
                        `Hello Ravinarayan Team, I would like to inquire about availability for ${room.name} in Met City / Yakubpur.`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3 rounded-full border border-emerald-600/30 text-emerald-700 hover:bg-emerald-50 transition-colors shadow-sm"
                      title="Enquire on WhatsApp"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Dedicated Section: All-Inclusive Standards & Transparency (Theme: Deep Botanical Green) */}
      <section className="py-20 sm:py-24 bg-[#16221A] text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#5D7656]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-4 shadow-xs">
              <span>ALL-INCLUSIVE RESIDENTIAL STANDARDS</span>
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-normal tracking-tight text-white">
              Every Room Format, <br />
              <span className="italic font-light text-[#C89F6B]">Every Everyday Comfort</span>
            </h2>
            <p className="mt-3 text-white/75 text-sm sm:text-base leading-relaxed font-light">
              Regardless of your chosen room format, all residents in Met City &amp; Yakubpur enjoy our 4 core facilities with zero hidden fees.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto mb-14">
            <div className="p-6 rounded-3xl bg-white/5 border border-white/10 space-y-3">
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Check className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-white">High-Speed Wi-Fi</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                Enterprise fiber connectivity designed for uninterrupted work calls and late-evening studies.
              </p>
            </div>

            <div className="p-6 rounded-3xl bg-white/5 border border-white/10 space-y-3">
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Check className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-white">24/7 RO Purified Water</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                Multi-stage reverse-osmosis filtration dispensers readily available across all residential floors.
              </p>
            </div>

            <div className="p-6 rounded-3xl bg-white/5 border border-white/10 space-y-3">
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Check className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-white">Continuous CCTV Safety</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                HD surveillance coverage across gates, entries, and hallways for verified resident safety.
              </p>
            </div>

            <div className="p-6 rounded-3xl bg-white/5 border border-white/10 space-y-3">
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-400">
                <Check className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-lg font-medium text-white">In-House Laundry</h3>
              <p className="text-xs text-white/70 leading-relaxed font-light">
                Accessible laundry machines and clean drying areas to keep your wardrobe fresh with zero hassle.
              </p>
            </div>
          </div>

          {/* Honest Guidance Box in Deep Theme */}
          <div className="p-7 rounded-3xl bg-white/10 border border-white/15 flex flex-col sm:flex-row items-start gap-4 max-w-3xl mx-auto backdrop-blur-md">
            <Info className="w-5 h-5 text-[#C89F6B] shrink-0 mt-0.5" />
            <div className="text-xs text-white/80 leading-relaxed space-y-1 font-light">
              <p className="font-semibold text-white">Authentic Accommodation Policy</p>
              <p>
                We believe in complete transparency. Exact room dimensions, bed configurations, and immediate vacancies are verified directly with management based on real-time availability. You are warmly welcome to visit our premises before finalizing your stay.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />

      <RoomModal
        room={activeModalRoom}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </main>
  );
}
