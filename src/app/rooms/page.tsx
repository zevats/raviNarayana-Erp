"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { RoomModal } from "@/components/RoomModal";
import { roomsData, RoomCategory } from "@/data/roomsData";
import { Check, ArrowUpRight, Sparkles, Filter, Phone, MessageSquare, Info } from "lucide-react";
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
    <main className="min-h-screen flex flex-col bg-ivory">
      <Navbar onOpenEnquiry={() => { setActiveModalRoom(roomsData[0]); setIsModalOpen(true); }} />

      {/* Header Banner */}
      <section className="relative pt-36 pb-20 bg-deep text-ivory overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/hero-bg.jpg"
            alt="Ravinarayan Rooms"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-deep via-deep/80 to-black/70" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-forest-light border border-brass/30 text-brass text-xs font-mono uppercase tracking-wider mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Living Spaces</span>
            </div>
            <h1 className="headline-hero font-serif font-bold text-ivory tracking-tight mb-4">
              Accommodations Designed for Tranquility
            </h1>
            <p className="text-base sm:text-lg text-cream/90 font-light leading-relaxed">
              Explore our 8 curated accommodation formats in Met City, Yakubpur, and Jhajjar. Each room category provides high-speed Wi-Fi, pure RO water, CCTV safety, and optional home-style meal service.
            </p>
          </div>
        </div>
      </section>

      {/* Rooms Showcase Section */}
      <section className="py-20 sm:py-28 bg-ivory">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-8 mb-12 border-b border-sage/20 gap-4">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
              <span className="text-xs uppercase tracking-wider text-forest font-mono mr-2 flex items-center gap-1 font-bold">
                <Filter className="w-3.5 h-3.5" /> Filter Category:
              </span>
              {filters.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setSelectedFilter(f)}
                  className={`px-4 py-2 rounded-full text-xs font-medium tracking-wide transition-all ${
                    selectedFilter === f
                      ? "bg-forest text-ivory font-bold shadow-md"
                      : "bg-cream text-charcoal hover:bg-forest/10 border border-sage/30"
                  }`}
                >
                  {f} {f === "All" ? `(${roomsData.length})` : ""}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <a
                href={`tel:${siteConfig.phoneRaw}`}
                className="inline-flex items-center gap-2 text-xs font-semibold text-forest hover:text-brass transition-colors"
              >
                <Phone className="w-3.5 h-3.5 text-brass" />
                <span>Call {siteConfig.phone}</span>
              </a>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filtered.map((room) => (
              <div
                key={room.id}
                className="group flex flex-col rounded-3xl bg-white border border-sage/20 shadow-md hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 overflow-hidden"
              >
                {/* Image */}
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-forest-dark">
                  <Image
                    src={room.image}
                    alt={room.name}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <span className="absolute top-4 left-4 px-3 py-1 rounded-full bg-forest-dark/90 backdrop-blur-md border border-brass/30 text-brass text-[11px] font-mono uppercase tracking-wider font-semibold">
                    {room.occupancyType} Room
                  </span>
                </div>

                {/* Details */}
                <div className="p-7 flex-1 flex flex-col justify-between space-y-6">
                  <div>
                    <h2 className="font-serif text-2xl font-bold text-forest group-hover:text-brass transition-colors mb-2">
                      {room.name}
                    </h2>
                    <p className="font-serif italic text-brass text-sm mb-3">
                      &ldquo;{room.tagline}&rdquo;
                    </p>
                    <p className="text-sm text-muted leading-relaxed mb-6">
                      {room.description}
                    </p>

                    <div className="space-y-2 pt-4 border-t border-charcoal/10">
                      <p className="text-[11px] uppercase tracking-wider text-forest font-mono font-bold">Key Inclusions</p>
                      <div className="grid grid-cols-2 gap-2">
                        {room.highlights.map((h) => (
                          <div key={h} className="flex items-center gap-1.5 text-xs text-charcoal/80">
                            <Check className="w-3.5 h-3.5 text-brass shrink-0" />
                            <span className="truncate">{h}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-charcoal/10 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleEnquire(room)}
                      className="flex-1 py-3 rounded-full bg-forest hover:bg-brass hover:text-forest-dark text-ivory text-xs font-bold tracking-wider uppercase transition-all duration-300 flex items-center justify-center gap-2 shadow-md"
                    >
                      <span>Check Vacancy</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                    <a
                      href={`https://wa.me/918571801102?text=${encodeURIComponent(
                        `Hello Ravinarayan Team, I would like to inquire about availability for ${room.name} in Met City / Yakubpur.`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3 rounded-full border border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 transition-colors"
                      title="Enquire on WhatsApp"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Honest Guidance Box */}
          <div className="mt-16 p-6 rounded-2xl bg-cream border border-sage/30 flex items-start gap-4 max-w-3xl mx-auto">
            <Info className="w-5 h-5 text-forest shrink-0 mt-0.5" />
            <div className="text-xs text-muted leading-relaxed space-y-1">
              <p className="font-bold text-forest">Authentic Accommodation Policy</p>
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
