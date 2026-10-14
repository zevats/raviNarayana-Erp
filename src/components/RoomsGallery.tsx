"use client";

import React, { useState } from "react";
import Image from "next/image";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Eye, Sparkles, Filter } from "lucide-react";
import { roomsData, RoomCategory } from "@/data/roomsData";

interface RoomsGalleryProps {
  onSelectRoom: (room: RoomCategory) => void;
}

export const RoomsGallery: React.FC<RoomsGalleryProps> = ({ onSelectRoom }) => {
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"grid" | "carousel">("grid");

  const filterOptions = ["All", "Single", "Double", "Suite", "Shared"];

  const filteredRooms = roomsData.filter((r) => {
    if (activeFilter === "All") return true;
    return r.occupancyType === activeFilter;
  });

  const nextSlide = () => {
    setActiveIndex((prev) => (prev + 1) % roomsData.length);
  };

  const prevSlide = () => {
    setActiveIndex((prev) => (prev - 1 + roomsData.length) % roomsData.length);
  };

  const currentCarouselRoom = roomsData[activeIndex];

  return (
    <section id="rooms" className="relative py-24 sm:py-32 bg-forest text-ivory overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(168,183,154,0.12),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(181,138,87,0.1),transparent_60%)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 sm:mb-16 gap-6">
          <div>
            <div className="inline-flex items-center gap-2 text-sage text-xs font-semibold tracking-widest uppercase mb-3">
              <span className="w-8 h-px bg-brass" />
              <span>02 &bull; Accommodations</span>
            </div>
            <h2 className="headline-display font-serif font-bold text-ivory tracking-tight">
              Thoughtfully Designed Rooms for Rest &amp; Focus
            </h2>
            <p className="mt-3 text-cream/80 max-w-xl text-sm sm:text-base leading-relaxed">
              Explore our 8 curated accommodation categories in Met City, Yakubpur, and Jhajjar. Each room is designed for privacy, hygiene, and peaceful living.
            </p>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-3">
            <div className="inline-flex p-1 rounded-full bg-forest-dark border border-sage/20 text-xs font-medium">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`px-4 py-2 rounded-full transition-all ${
                  viewMode === "grid"
                    ? "bg-brass text-forest-dark font-bold shadow-md"
                    : "text-cream/80 hover:text-ivory"
                }`}
              >
                Editorial Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode("carousel")}
                className={`px-4 py-2 rounded-full transition-all ${
                  viewMode === "carousel"
                    ? "bg-brass text-forest-dark font-bold shadow-md"
                    : "text-cream/80 hover:text-ivory"
                }`}
              >
                Cinematic Tour
              </button>
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-10 scrollbar-none">
          <span className="text-xs uppercase tracking-wider text-sage font-mono mr-2 hidden sm:inline-flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </span>
          {filterOptions.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setActiveFilter(f)}
              className={`px-4 py-2 rounded-full text-xs font-medium tracking-wide transition-all shrink-0 ${
                activeFilter === f
                  ? "bg-sage text-forest-dark font-bold"
                  : "bg-forest-light/60 text-cream/80 hover:text-ivory hover:bg-forest-light border border-sage/20"
              }`}
            >
              {f} {f === "All" ? `(${roomsData.length})` : ""}
            </button>
          ))}
        </div>

        {/* View Mode 1: Editorial Grid */}
        {viewMode === "grid" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
            {filteredRooms.map((room) => (
              <div
                key={room.id}
                className="group relative flex flex-col rounded-2xl sm:rounded-3xl bg-[#102A22]/90 border border-sage/20 overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-500 hover:-translate-y-1"
              >
                {/* Room Image */}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-forest-dark">
                  <Image
                    src={room.image}
                    alt={room.name}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#102A22] via-transparent to-transparent opacity-80" />

                  {/* Occupancy Badge */}
                  <span className="absolute top-3 left-3 px-3 py-1 rounded-full bg-forest-dark/80 backdrop-blur-md border border-brass/30 text-brass text-[10px] font-mono tracking-wider uppercase">
                    {room.occupancyType}
                  </span>
                </div>

                {/* Card Content */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ivory group-hover:text-brass transition-colors mb-1.5">
                      {room.name}
                    </h3>
                    <p className="text-xs text-sage line-clamp-2 leading-relaxed mb-4">
                      {room.description}
                    </p>

                    {/* Highlights */}
                    <div className="grid grid-cols-2 gap-2 mb-4 pt-3 border-t border-sage/15">
                      {room.highlights.slice(0, 4).map((h) => (
                        <div key={h} className="flex items-center gap-1.5 text-[11px] text-cream/80">
                          <Check className="w-3 h-3 text-brass shrink-0" />
                          <span className="truncate">{h}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => onSelectRoom(room)}
                      className="w-full py-2.5 rounded-xl bg-forest-light hover:bg-brass hover:text-forest-dark text-ivory text-xs font-bold tracking-wider uppercase transition-all duration-300 flex items-center justify-center gap-1.5 border border-sage/20 group-hover:border-brass/40"
                    >
                      <span>Enquire Room</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* View Mode 2: Cinematic Carousel / Tour */}
        {viewMode === "carousel" && (
          <div className="relative rounded-3xl bg-[#102A22] border border-sage/30 overflow-hidden shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[500px]">
              {/* Carousel Image Main */}
              <div className="relative lg:col-span-7 h-72 sm:h-96 lg:h-full w-full overflow-hidden bg-forest-dark">
                <Image
                  src={currentCarouselRoom.image}
                  alt={currentCarouselRoom.name}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 60vw"
                  className="object-cover transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-forest-dark/80 via-transparent to-transparent lg:hidden" />

                {/* Counter */}
                <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-ivory text-xs font-mono">
                  {activeIndex + 1} / {roomsData.length}
                </div>
              </div>

              {/* Carousel Room Details */}
              <div className="lg:col-span-5 p-6 sm:p-10 flex flex-col justify-between">
                <div>
                  <div className="inline-block px-3 py-1 rounded-full bg-brass/20 text-brass text-xs font-mono uppercase tracking-wider mb-4 border border-brass/30">
                    {currentCarouselRoom.occupancyType} Room Category
                  </div>
                  <h3 className="font-serif text-2xl sm:text-3xl font-bold text-ivory mb-2">
                    {currentCarouselRoom.name}
                  </h3>
                  <p className="font-serif italic text-sage text-base mb-4">
                    &ldquo;{currentCarouselRoom.tagline}&rdquo;
                  </p>
                  <p className="text-sm text-cream/80 leading-relaxed mb-6">
                    {currentCarouselRoom.description}
                  </p>

                  <div className="space-y-2 mb-6">
                    <p className="text-xs uppercase tracking-wider text-sage font-mono">Features &amp; Living Standard</p>
                    <div className="grid grid-cols-2 gap-2">
                      {currentCarouselRoom.highlights.map((h) => (
                        <div key={h} className="flex items-center gap-2 text-xs text-cream/90">
                          <Check className="w-3.5 h-3.5 text-brass" />
                          <span>{h}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between pt-6 border-t border-sage/20 mb-4">
                    <button
                      type="button"
                      onClick={() => onSelectRoom(currentCarouselRoom)}
                      className="px-6 py-3 rounded-full bg-brass hover:bg-brass-light text-forest-dark font-bold text-xs tracking-wider uppercase transition-all shadow-lg flex items-center gap-2"
                    >
                      <span>Enquire This Room</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={prevSlide}
                        className="p-3 rounded-full bg-forest-dark text-cream hover:text-ivory hover:bg-forest-light border border-sage/20 transition-colors"
                        aria-label="Previous room"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={nextSlide}
                        className="p-3 rounded-full bg-forest-dark text-cream hover:text-ivory hover:bg-forest-light border border-sage/20 transition-colors"
                        aria-label="Next room"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Thumbnail Row */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {roomsData.map((rm, i) => (
                      <button
                        key={rm.id}
                        type="button"
                        onClick={() => setActiveIndex(i)}
                        className={`relative w-12 h-10 rounded-lg overflow-hidden shrink-0 border-2 transition-all ${
                          activeIndex === i ? "border-brass scale-105" : "border-transparent opacity-60 hover:opacity-100"
                        }`}
                        aria-label={`Show ${rm.name}`}
                      >
                        <Image src={rm.image} alt={rm.name} fill className="object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Honest Transparency Note */}
        <div className="mt-12 text-center">
          <p className="text-xs text-sage/80 max-w-2xl mx-auto">
            * Note: Room dimensions, furniture layouts, and seasonal availability are confirmed with guesthouse management during your direct phone or WhatsApp enquiry. Exact configurations may vary by floor and property wing.
          </p>
        </div>
      </div>
    </section>
  );
};
