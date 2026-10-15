"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  Maximize2,
} from "lucide-react";
import { roomsData, RoomCategory } from "@/data/roomsData";
import { GalleryLightbox, GalleryImage } from "./GalleryLightbox";

interface RoomsGalleryProps {
  onSelectRoom: (room: RoomCategory) => void;
}

const propertyGalleryImages: GalleryImage[] = [
  {
    src: "/hero-bg.jpg",
    title: "Executive Private Room Interior",
    category: "Rooms",
    description: "Quiet, peaceful bedroom with wooden study desk, hygienic bedding, and soft ambient lighting.",
  },
  {
    src: "/gallery/bedroom-deluxe.jpg",
    title: "Deluxe Single Suite",
    category: "Rooms",
    description: "Spacious private accommodation tailored for working corporate executives and long-term residents.",
  },
  {
    src: "/gallery/room-1.jpg",
    title: "Executive Workspace Setup",
    category: "Workspaces",
    description: "High-speed fiber Wi-Fi, ergonomic task chair, and dedicated power outlets for study and work.",
  },
  {
    src: "/gallery/stairs.jpg",
    title: "Botanical Corridors & Lobby",
    category: "Property",
    description: "Immaculately maintained architectural hallways with daily housekeeping and secure stairwells.",
  },
  {
    src: "/gallery/bedroom-spacious.jpg",
    title: "Spacious Double Sharing Room",
    category: "Rooms",
    description: "Twin-bed arrangement providing personal storage wardrobes, privacy, and natural sunlight.",
  },
  {
    src: "/gallery/room-2.jpg",
    title: "Sunlit Room with Wardrobe",
    category: "Rooms",
    description: "Cross-ventilated rooms with private storage lockers and clean ceramic tile finishes.",
  },
  {
    src: "/gallery/tiffin.png",
    title: "Nutritious Fresh Tiffin Meals",
    category: "Dining",
    description: "Wholesome home-style vegetarian thali prepared daily with pure ghee, lentils, and fresh rotis.",
  },
  {
    src: "/gallery/room-3.jpg",
    title: "Standard Single Room",
    category: "Rooms",
    description: "Compact, affordable private room designed for students and industrial professionals.",
  },
  {
    src: "/gallery/room-4.jpg",
    title: "Comfort Quad Accommodation",
    category: "Rooms",
    description: "Cost-effective shared living with individual study desks and personal lockable storage.",
  },
  {
    src: "/gallery/bedroom-5.jpg",
    title: "Quiet Study Nook",
    category: "Workspaces",
    description: "Dedicated quiet corners designed for deep focus and undisturbed late-night project work.",
  },
  {
    src: "/gallery/bedroom-6.jpg",
    title: "Ventilated Corner Suite",
    category: "Rooms",
    description: "Corner bedroom layout with expansive windows overlooking peaceful surrounding greenery.",
  },
];

export const RoomsGallery: React.FC<RoomsGalleryProps> = ({ onSelectRoom }) => {
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"grid" | "gallery" | "carousel">("grid");

  // Lightbox State
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState<boolean>(false);

  const openLightboxWithImage = (index: number) => {
    setLightboxIndex(index);
    setIsLightboxOpen(true);
  };

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
    <section id="rooms" className="relative py-24 sm:py-32 bg-[#FAF8F5] text-[#263B2D] overflow-hidden scroll-mt-20">
      {/* Background Ambience Subtle Accents */}
      <div className="absolute top-1/4 right-0 w-96 h-96 bg-[#8E9F89]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-0 w-96 h-96 bg-[#B58A57]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between mb-12 sm:mb-16 gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#5D7656]/20 bg-[#5D7656]/10 text-[#263B2D] text-[11px] font-sans tracking-[0.2em] uppercase font-semibold mb-3 shadow-sm">
              <span>02 &bull; Accommodations &amp; Gallery</span>
            </div>
            <h2 className="font-serif text-[#1A2E20] text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-normal tracking-tight leading-[1.08]">
              Thoughtfully Designed <br className="hidden sm:inline" />
              <span className="italic font-light">Living Spaces</span>
            </h2>
            <p className="mt-3 text-[#4A584E] max-w-xl text-sm sm:text-base leading-relaxed font-light">
              Explore our curated accommodations and property photography in Met City, Yakubpur, and Jhajjar. Each space is tailored for hygiene, privacy, and calm focus.
            </p>
          </div>

          {/* View Mode Toggle: Grid, Resorto Gallery, Carousel */}
          <div className="flex items-center gap-3">
            <div className="inline-flex p-1 rounded-full bg-[#EAE5D9]/70 border border-[#8E9F89]/25 text-xs font-medium shadow-inner">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`px-4 py-2 rounded-full transition-all text-xs font-semibold tracking-wide ${
                  viewMode === "grid"
                    ? "bg-[#1A2E20] text-white shadow-sm"
                    : "text-[#4A584E] hover:text-[#1A2E20]"
                }`}
              >
                Room Cards
              </button>
              <button
                type="button"
                onClick={() => setViewMode("gallery")}
                className={`px-4 py-2 rounded-full transition-all text-xs font-semibold tracking-wide ${
                  viewMode === "gallery"
                    ? "bg-[#1A2E20] text-white shadow-sm"
                    : "text-[#4A584E] hover:text-[#1A2E20]"
                }`}
              >
                Photo Gallery
              </button>
              <button
                type="button"
                onClick={() => setViewMode("carousel")}
                className={`px-4 py-2 rounded-full transition-all text-xs font-semibold tracking-wide ${
                  viewMode === "carousel"
                    ? "bg-[#1A2E20] text-white shadow-sm"
                    : "text-[#4A584E] hover:text-[#1A2E20]"
                }`}
              >
                Cinematic Tour
              </button>
            </div>
          </div>
        </div>

        {/* Filter Pills (shown for Room Cards view) */}
        {viewMode === "grid" && (
          <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-10 scrollbar-none">
            <span className="text-xs uppercase tracking-wider text-[#5E715C] font-mono mr-2 hidden sm:inline-flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> Filter:
            </span>
            {filterOptions.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setActiveFilter(f)}
                className={`px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition-all shrink-0 ${
                  activeFilter === f
                    ? "bg-[#1A2E20] text-white shadow-md"
                    : "bg-white text-[#4A584E] hover:text-[#1A2E20] border border-[#8E9F89]/25 shadow-sm"
                }`}
              >
                {f} {f === "All" ? `(${roomsData.length})` : ""}
              </button>
            ))}
          </div>
        )}

        {/* View Mode 1: Editorial Room Cards (Clean White Surfaces) */}
        {viewMode === "grid" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
            {filteredRooms.map((room) => {
              const galIdx = propertyGalleryImages.findIndex((g) => g.src === room.image);

              return (
                <div
                  key={room.id}
                  className="group relative flex flex-col rounded-3xl bg-white border border-[#8E9F89]/20 overflow-hidden shadow-md hover:shadow-2xl transition-all duration-500 hover:-translate-y-1"
                >
                  {/* Room Image */}
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#EAE5D9]">
                    <Image
                      src={room.image}
                      alt={room.name}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-60" />

                    {/* Occupancy Badge */}
                    <span className="absolute top-3 left-3 px-3 py-1 rounded-full bg-white/95 backdrop-blur-md border border-[#8E9F89]/30 text-[#1A2E20] text-[10px] font-sans font-semibold tracking-wider uppercase shadow-sm">
                      {room.occupancyType}
                    </span>

                    {/* Quick Lightbox Zoom Button */}
                    <button
                      type="button"
                      onClick={() => openLightboxWithImage(galIdx !== -1 ? galIdx : 0)}
                      className="absolute top-3 right-3 p-2 rounded-full bg-black/60 hover:bg-[#1A2E20] text-white transition-colors backdrop-blur-md border border-white/20 opacity-0 group-hover:opacity-100 shadow-md"
                      aria-label={`View photo of ${room.name}`}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Card Content */}
                  <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-serif text-xl sm:text-2xl font-medium text-[#1A2E20] group-hover:text-[#5D7656] transition-colors mb-1.5">
                        {room.name}
                      </h3>
                      <p className="text-xs sm:text-sm text-[#4A584E] line-clamp-2 leading-relaxed mb-4 font-light">
                        {room.description}
                      </p>

                      {/* Highlights */}
                      <div className="grid grid-cols-2 gap-2 mb-5 pt-3.5 border-t border-[#8E9F89]/20">
                        {room.highlights.slice(0, 4).map((h) => (
                          <div key={h} className="flex items-center gap-1.5 text-xs text-[#263B2D]">
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">{h}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action — Cabana Style Pill with Arrow */}
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => onSelectRoom(room)}
                        className="w-full py-3 px-4 rounded-full bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold tracking-wide transition-all duration-300 flex items-center justify-between shadow-md hover:shadow-lg group/btn"
                      >
                        <span>Enquire Room</span>
                        <div className="w-6 h-6 rounded-full bg-white text-[#1A2E20] flex items-center justify-center group-hover/btn:scale-105 transition-transform">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* View Mode 2: Resorto Photo Gallery with Lightbox */}
        {viewMode === "gallery" && (
          <div>
            <div className="columns-1 sm:columns-2 lg:columns-3 gap-6 space-y-6">
              {propertyGalleryImages.map((img, idx) => (
                <div
                  key={idx}
                  onClick={() => openLightboxWithImage(idx)}
                  className="break-inside-avoid relative rounded-3xl overflow-hidden group cursor-pointer border border-[#8E9F89]/25 bg-white shadow-md hover:shadow-2xl transition-all duration-500"
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#EAE5D9]">
                    <Image
                      src={img.src}
                      alt={img.title}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent opacity-60 group-hover:opacity-90 transition-opacity duration-300" />
                  </div>

                  {/* Hover Overlay Details */}
                  <div className="absolute inset-0 p-5 flex flex-col justify-between pointer-events-none">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/90 backdrop-blur-md border border-[#8E9F89]/30 text-[#1A2E20] font-semibold">
                        {img.category}
                      </span>
                      <div className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-white group-hover:bg-white group-hover:text-[#1A2E20] transition-colors">
                        <Maximize2 className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                      <h3 className="font-serif text-lg font-medium text-white group-hover:text-white transition-colors">
                        {img.title}
                      </h3>
                      {img.description && (
                        <p className="text-xs text-white/80 line-clamp-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 font-light">
                          {img.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-8 text-center text-xs text-[#5E715C] font-mono">
              Tip: Click any image to view in full resolution with keyboard arrow navigation.
            </p>
          </div>
        )}

        {/* View Mode 3: Cinematic Tour (Rich Botanical Contrast Card) */}
        {viewMode === "carousel" && (
          <div className="relative rounded-3xl bg-[#16221A] border border-white/10 overflow-hidden shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[500px]">
              {/* Carousel Image Main */}
              <div
                className="relative lg:col-span-7 h-72 sm:h-96 lg:h-full w-full overflow-hidden bg-[#1E2D22] cursor-pointer group"
                onClick={() => {
                  const galIdx = propertyGalleryImages.findIndex(
                    (g) => g.src === currentCarouselRoom.image
                  );
                  openLightboxWithImage(galIdx !== -1 ? galIdx : 0);
                }}
              >
                <Image
                  src={currentCarouselRoom.image}
                  alt={currentCarouselRoom.name}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 60vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#16221A]/80 via-transparent to-transparent lg:hidden" />

                {/* Counter & Zoom Hint */}
                <div className="absolute top-4 left-4 flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-white text-xs font-mono">
                    {activeIndex + 1} / {roomsData.length}
                  </span>
                  <span className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-white/90 text-xs font-mono flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Maximize2 className="w-3.5 h-3.5" /> Click to enlarge
                  </span>
                </div>
              </div>

              {/* Carousel Room Details */}
              <div className="lg:col-span-5 p-6 sm:p-10 flex flex-col justify-between text-white">
                <div>
                  <div className="inline-block px-3 py-1 rounded-full bg-white/10 text-white/90 text-xs font-mono uppercase tracking-wider mb-4 border border-white/15">
                    {currentCarouselRoom.occupancyType} Room Category
                  </div>
                  <h3 className="font-serif text-2xl sm:text-3xl font-medium text-white mb-2">
                    {currentCarouselRoom.name}
                  </h3>
                  <p className="font-serif italic text-[#A8B9A1] text-base mb-4">
                    &ldquo;{currentCarouselRoom.tagline}&rdquo;
                  </p>
                  <p className="text-sm text-white/80 leading-relaxed mb-6 font-light">
                    {currentCarouselRoom.description}
                  </p>

                  <div className="space-y-2 mb-6">
                    <p className="text-xs uppercase tracking-wider text-[#A8B9A1] font-mono">Features &amp; Living Standard</p>
                    <div className="grid grid-cols-2 gap-2">
                      {currentCarouselRoom.highlights.map((h) => (
                        <div key={h} className="flex items-center gap-2 text-xs text-white/90">
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{h}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between pt-6 border-t border-white/15 mb-4">
                    <button
                      type="button"
                      onClick={() => onSelectRoom(currentCarouselRoom)}
                      className="px-6 py-3.5 rounded-full bg-white hover:bg-white/95 text-[#1A2E20] font-semibold text-xs tracking-wide transition-all shadow-xl flex items-center gap-2.5 group/btn"
                    >
                      <span>Enquire This Room</span>
                      <div className="w-6 h-6 rounded-full bg-[#1A2E20] text-white flex items-center justify-center group-hover/btn:scale-105 transition-transform">
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </div>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={prevSlide}
                        className="p-3 rounded-full bg-white/10 text-white hover:bg-white/20 border border-white/15 transition-colors"
                        aria-label="Previous room"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={nextSlide}
                        className="p-3 rounded-full bg-white/10 text-white hover:bg-white/20 border border-white/15 transition-colors"
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
                          activeIndex === i ? "border-white scale-105" : "border-transparent opacity-60 hover:opacity-100"
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
          <p className="text-xs text-[#5E715C] max-w-2xl mx-auto">
            * Note: Room dimensions, furniture layouts, and seasonal availability are confirmed with guesthouse management during your direct phone or WhatsApp enquiry. Exact configurations may vary by floor and property wing.
          </p>
        </div>
      </div>

      {/* Full-Screen Accessible Gallery Lightbox */}
      <GalleryLightbox
        images={propertyGalleryImages}
        currentIndex={lightboxIndex}
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
        onNavigate={(newIndex) => setLightboxIndex(newIndex)}
      />
    </section>
  );
};
