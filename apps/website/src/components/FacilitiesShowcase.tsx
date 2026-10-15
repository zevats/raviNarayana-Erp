"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { LUXURY_EASE } from "@/utils/motion";

interface ShowcaseItem {
  id: string;
  bottomTitle: string;
  centerTitle: string;
  eyebrow: string;
  description: string;
  image: string;
  link: string;
}

const showcaseItems: ShowcaseItem[] = [
  {
    id: "single-occupancy",
    bottomTitle: "SINGLE OCCUPANCY",
    centerTitle: "SINGLE OCCUPANCY",
    eyebrow: "Premium Single Room",
    description:
      "Quiet personal space tailored for focused living, complete with dedicated work desk, enterprise fiber Wi-Fi, and total privacy.",
    image: "/gallery/room-1.jpg",
    link: "/rooms",
  },
  {
    id: "double-sharing",
    bottomTitle: "DOUBLE SHARING",
    centerTitle: "DOUBLE SHARING",
    eyebrow: "Deluxe Double Room",
    description:
      "Generously proportioned double layout providing comfortable twin bedding, individual wardrobe storage, and optimal cross-ventilation.",
    image: "/gallery/room-2.jpg",
    link: "/rooms",
  },
  {
    id: "private-suites",
    bottomTitle: "PRIVATE SUITES",
    centerTitle: "PRIVATE SUITES",
    eyebrow: "Executive Master Bedroom",
    description:
      "Sunlit dimensions with premium residential furnishings, attached modern washroom, full-length mirror, and extensive closet space.",
    image: "/gallery/room-4.jpg",
    link: "/rooms",
  },
  {
    id: "essential-comforts",
    bottomTitle: "ESSENTIAL COMFORTS",
    centerTitle: "ESSENTIAL COMFORTS",
    eyebrow: "Verified Living Facilities",
    description:
      "High-Speed Wi-Fi, 24/7 RO Purified Water, continuous CCTV Security, and In-House Laundry provided with every room format.",
    image: "/gallery/stairs.jpg",
    link: "/rooms",
  },
];

export function FacilitiesShowcase() {
  const shouldReduceMotion = useReducedMotion();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <section
      id="facilities-spaces"
      className="relative w-full h-[85vh] min-h-[660px] max-h-[880px] bg-[#0A100C] overflow-hidden select-none"
      aria-label="Ravinarayan PG Living Spaces & Facilities"
    >
      {/* 1. Camera-Focus Crossfading Backgrounds (Slow, smooth, luxurious settle) */}
      {/* Default Initial Image */}
      <div
        className={`absolute inset-0 z-0 transition-all duration-1000 ease-in-out pointer-events-none ${
          hoveredIndex === null
            ? "opacity-100 scale-100 filter brightness-[0.82] contrast-[1.05]"
            : "opacity-0 scale-[1.04] filter brightness-[0.6] contrast-[1.0]"
        }`}
      >
        <Image
          src="/gallery/room-1.jpg"
          alt="Ravinarayan PG Facilities & Living Spaces"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/65" />
      </div>

      {/* Per-Item Focused Zoom Hover Images (Slow, gradual 1.10 -> 1.0 zoom settle over 1100ms) */}
      {showcaseItems.map((item, idx) => {
        const isCurrent = hoveredIndex === idx;
        return (
          <div
            key={item.id}
            className={`absolute inset-0 z-0 pointer-events-none transition-opacity duration-1000 ease-in-out ${
              isCurrent ? "opacity-100" : "opacity-0"
            }`}
          >
            <div
              className={`relative w-full h-full transition-transform duration-1200 ease-out ${
                isCurrent ? "scale-100" : "scale-[1.10]"
              }`}
            >
              <Image
                src={item.image}
                alt={item.bottomTitle}
                fill
                sizes="100vw"
                className="object-cover object-center filter brightness-[0.84] contrast-[1.08]"
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/65" />
          </div>
        );
      })}

      {/* 2. Giant Centered Typography (Gradual 800ms layered crossfade) */}
      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none px-4 text-center">
        {/* Initial "OUR FACILITIES" title */}
        <h2
          className={`absolute font-serif uppercase tracking-[0.05em] text-white transition-all duration-800 ease-out select-none ${
            hoveredIndex === null
              ? "opacity-100 scale-100 blur-0"
              : "opacity-0 scale-[0.97] blur-[1px]"
          }`}
          style={{
            fontSize: "clamp(38px, 8vw, 120px)",
            fontWeight: 400,
            lineHeight: 1.05,
            textShadow:
              "0 4px 30px rgba(0, 0, 0, 0.7), 0 2px 8px rgba(0, 0, 0, 0.5)",
          }}
        >
          OUR FACILITIES
        </h2>

        {/* Per-item titles that smoothly transition in place */}
        {showcaseItems.map((item, idx) => {
          const isCurrent = hoveredIndex === idx;
          return (
            <h2
              key={item.id}
              className={`absolute font-serif uppercase tracking-[0.05em] text-white transition-all duration-800 ease-out select-none ${
                isCurrent
                  ? "opacity-100 scale-100 blur-0"
                  : "opacity-0 scale-[1.03] blur-[1px]"
              }`}
              style={{
                fontSize: "clamp(38px, 8vw, 120px)",
                fontWeight: 400,
                lineHeight: 1.05,
                textShadow:
                  "0 4px 30px rgba(0, 0, 0, 0.7), 0 2px 8px rgba(0, 0, 0, 0.5)",
              }}
            >
              {item.centerTitle}
            </h2>
          );
        })}
      </div>

      {/* 3. 4-Column Grid with Vertical Divider Lines */}
      <div className="relative z-20 w-full h-full grid grid-cols-1 md:grid-cols-4">
        {showcaseItems.map((item, idx) => {
          const isHovered = hoveredIndex === idx;

          return (
            <Link
              key={item.id}
              href={item.link}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setHoveredIndex(idx)}
              onBlur={() => setHoveredIndex(null)}
              className="group relative flex flex-col justify-end items-start h-full p-6 sm:p-8 lg:p-10 pb-12 sm:pb-14 lg:pb-16 text-left no-underline transition-colors duration-500 md:border-r border-white/20 last:border-r-0 focus:outline-none"
            >
              {/* Subtle hover backlight for column */}
              <div
                className={`absolute inset-0 bg-white/[0.04] transition-opacity duration-500 pointer-events-none ${
                  isHovered ? "opacity-100" : "opacity-0"
                }`}
              />

              {/* Bottom Card Content with Staggered Scroll Entrance */}
              <motion.div
                className="relative z-10 w-full"
                initial={
                  shouldReduceMotion
                    ? { opacity: 1, y: 0, filter: "blur(0px)" }
                    : { opacity: 0, y: 26, filter: "blur(4px)" }
                }
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 1.15, delay: 0.15 * idx, ease: LUXURY_EASE }}
              >
                {/* Eyebrow format badge */}
                <span
                  className={`block text-[11px] sm:text-xs uppercase tracking-[0.2em] font-sans font-medium transition-all duration-500 ${
                    isHovered
                      ? "text-[#C89F6B] opacity-100 translate-y-0"
                      : "text-white/60 opacity-0 -translate-y-1 h-0 overflow-hidden"
                  }`}
                >
                  {item.eyebrow}
                </span>

                {/* Column Headline */}
                <h3 className="font-serif text-lg sm:text-xl lg:text-[24px] xl:text-[26px] uppercase tracking-wider text-white font-normal leading-tight mt-1 transition-colors duration-500">
                  {item.bottomTitle}
                </h3>

                {/* Horizontal Accent Line with Smooth Fill (NO CIRCLE, elegant 700ms expansion) */}
                <div className="w-full relative my-3.5 h-[1.5px] bg-white/25 overflow-hidden">
                  <div
                    className={`h-full bg-white transition-all duration-700 ease-out ${
                      isHovered ? "w-full" : "w-0"
                    }`}
                  />
                </div>

                {/* Description Paragraph (Revealed on hover with smooth 700ms height expansion) */}
                <div
                  className={`transition-all duration-700 ease-out overflow-hidden font-sans ${
                    isHovered
                      ? "opacity-100 max-h-44"
                      : "opacity-0 max-h-0 md:max-h-0"
                  }`}
                >
                  <p className="text-xs sm:text-sm lg:text-[14px] text-stone-200/90 leading-relaxed font-light">
                    {item.description}
                  </p>
                  <span className="inline-flex items-center gap-1.5 mt-3 text-[11px] sm:text-xs uppercase tracking-widest text-[#C89F6B] font-semibold group-hover:text-white transition-colors duration-300">
                    Explore Format &rarr;
                  </span>
                </div>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
