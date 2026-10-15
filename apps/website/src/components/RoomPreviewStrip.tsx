"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

interface PreviewRoom {
  title: string;
  type: string;
  image: string;
  note: string;
}

const previewRooms: PreviewRoom[] = [
  {
    title: "Premium Single Room",
    type: "Single Occupancy",
    image: "/gallery/room-1.jpg",
    note: "Quiet personal space with dedicated work desk",
  },
  {
    title: "Deluxe Double Room",
    type: "Double Sharing",
    image: "/gallery/bedroom-deluxe.jpg",
    note: "Spacious layout with cross-ventilation and storage",
  },
  {
    title: "Executive Master Bedroom",
    type: "Private Suite",
    image: "/gallery/room-4.jpg",
    note: "Sunlit dimensions with extensive wardrobe space",
  },
];

export const RoomPreviewStrip: React.FC = () => {
  return (
    <section className="py-16 sm:py-24 bg-[#FAF8F5] border-t border-[#8E9F89]/15">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 sm:mb-16 gap-6">
          <div className="max-w-xl">
            <span className="text-[11px] font-sans tracking-[0.2em] uppercase font-semibold text-[#5E715C]">
              ACCOMMODATIONS
            </span>
            <h2 className="font-serif text-[#1A2E20] text-3xl sm:text-4xl md:text-5xl font-normal tracking-tight mt-2 leading-[1.1]">
              A Glimpse Into Our Living Spaces
            </h2>
          </div>

          <Link
            href="/rooms"
            className="inline-flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-[#1A2E20] hover:text-[#5D7656] transition-colors group"
          >
            <span>Explore All 8 Accommodations</span>
            <div className="w-6 h-6 rounded-full bg-[#1A2E20] text-white flex items-center justify-center group-hover:scale-105 transition-transform">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </Link>
        </div>

        {/* 3-Photo Visual Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          {previewRooms.map((room, idx) => (
            <Link
              key={idx}
              href="/rooms"
              className="group block rounded-3xl overflow-hidden bg-white border border-[#8E9F89]/20 shadow-sm hover:shadow-xl transition-all duration-500 hover:-translate-y-1"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#EAE5D9]">
                <Image
                  src={room.image}
                  alt={room.title}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                <span className="absolute top-4 left-4 px-3 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/20 text-white text-[10px] font-mono tracking-wider uppercase font-medium">
                  {room.type}
                </span>
              </div>

              <div className="p-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-xl font-medium text-[#1A2E20] group-hover:text-[#5D7656] transition-colors">
                    {room.title}
                  </h3>
                  <div className="w-7 h-7 rounded-full border border-[#8E9F89]/30 flex items-center justify-center text-[#1A2E20] group-hover:bg-[#1A2E20] group-hover:text-white transition-all">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </div>
                </div>
                <p className="text-xs text-[#5E715C] font-light mt-1.5 leading-relaxed">
                  {room.note}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};
