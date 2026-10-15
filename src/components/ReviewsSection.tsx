"use client";

import React from "react";
import { Star } from "lucide-react";
import { motion } from "framer-motion";
import { MaskedHeading } from "@/components/motion/MotionText";
import { LUXURY_EASE } from "@/utils/motion";

interface ReviewItem {
  id: string;
  name: string;
  role: string;
  quote: string;
  avatar: string;
}

// Replica of reference reviews dataset (3 distinct columns)
const column1Reviews: ReviewItem[] = [
  {
    id: "col1-1",
    name: "Kevin Clint",
    role: "Resident • Met City",
    quote:
      "The quiet environment and high-speed Wi-Fi make working remotely completely hassle-free. Rooms are well-ventilated, hygienic, and the management is always respectful.",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80",
  },
  {
    id: "col1-2",
    name: "Daniel Carter",
    role: "Operations Engineer",
    quote:
      "Clean washrooms, sturdy study desks, and attentive staff. Compared to other accommodations in the region, Ravinarayan maintains genuine cleanliness and quiet nights.",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80",
  },
  {
    id: "col1-3",
    name: "Manish Rawat",
    role: "Senior Plant Executive",
    quote:
      "Zero brokerage, direct owner coordination, and peaceful surroundings. Routine queries and maintenance are attended to immediately with no delays.",
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120&auto=format&fit=crop&q=80",
  },
];

const column2Reviews: ReviewItem[] = [
  {
    id: "col2-1",
    name: "Olivia Scott",
    role: "Technical Specialist",
    quote:
      "Daily tiffin meal delivery is consistently fresh, light on oil, and arrives hot. Having RO drinking water and laundry facilities readily available makes everyday living simple.",
    avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&auto=format&fit=crop&q=80",
  },
  {
    id: "col2-2",
    name: "David Mark",
    role: "Industrial Consultant",
    quote:
      "Three hot home-style meals a day prepared with pure RO filtered water. Wholesome vegetarian cooking that feels like home, delivered punctually.",
    avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=120&auto=format&fit=crop&q=80",
  },
  {
    id: "col2-3",
    name: "Siddharth Roy",
    role: "Project Engineer",
    quote:
      "Spacious room layout, high ceilings, and uncompromised privacy. Returning to a quiet, clean room after long shifts in the industrial zone is invaluable.",
    avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&auto=format&fit=crop&q=80",
  },
];

const column3Reviews: ReviewItem[] = [
  {
    id: "col3-1",
    name: "T. Steaphny",
    role: "Graduate Scholar",
    quote:
      "Verified CCTV security and gated entry offer total peace of mind. Single occupancy gives me the privacy needed for focused late-evening study without disturbance.",
    avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=120&auto=format&fit=crop&q=80",
  },
  {
    id: "col3-2",
    name: "Zack Ryan",
    role: "Supply Chain Manager",
    quote:
      "Double sharing room format is generously sized with individual wardrobes. In-house laundry facilities make weekday living completely seamless.",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80",
  },
  {
    id: "col3-3",
    name: "Amit Choudhary",
    role: "Quality Assurance Specialist",
    quote:
      "Uninterrupted fiber Wi-Fi coverage across all floors. Clean drinking water, professional atmosphere, and respectful co-residents throughout the property.",
    avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=120&auto=format&fit=crop&q=80",
  },
];

// Helper component for single review card exactly matching the reference
const ReviewCard: React.FC<{ item: ReviewItem }> = ({ item }) => (
  <div className="rounded-2xl sm:rounded-3xl bg-[#141C16] border border-white/10 p-7 sm:p-8 shadow-xl flex flex-col justify-between space-y-6 hover:border-white/25 transition-all duration-300 group/card">
    {/* Top Row: Double Quote Icon + 5 Stars */}
    <div className="flex items-center justify-between">
      <svg className="w-8 h-8 text-white/90 fill-current shrink-0" viewBox="0 0 24 24">
        <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
      </svg>
      <div className="flex items-center gap-1 text-white/90">
        {[...Array(5)].map((_, i) => (
          <Star key={i} className="w-4 h-4 fill-white text-white" />
        ))}
      </div>
    </div>

    {/* Middle Row: Quote Text */}
    <p className="text-sm sm:text-[15px] text-white/80 leading-relaxed font-light">
      &ldquo;{item.quote}&rdquo;
    </p>

    {/* Bottom Row: Avatar + Name + Subtitle */}
    <div className="flex items-center gap-3.5 pt-4 border-t border-white/10">
      <div className="relative w-12 h-12 rounded-full overflow-hidden border border-white/20 shrink-0 bg-white/10">
        <img
          src={item.avatar}
          alt={item.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div>
        <h4 className="font-serif font-bold text-white text-sm sm:text-base tracking-wide uppercase">
          {item.name}
        </h4>
        <p className="text-[11px] sm:text-xs text-white/50 font-light mt-0.5">
          {item.role}
        </p>
      </div>
    </div>
  </div>
);

export const ReviewsSection: React.FC = () => {
  // Duplicated arrays for seamless infinite loop (0% -> -50%)
  const col1 = [...column1Reviews, ...column1Reviews];
  const col2 = [...column2Reviews, ...column2Reviews];
  const col3 = [...column3Reviews, ...column3Reviews];

  return (
    <section
      id="reviews"
      className="relative py-20 sm:py-24 bg-[#0A100C] text-white overflow-hidden scroll-mt-20 select-none"
    >
      {/* Background Ambient Botanical Lighting */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-[#5D7656]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] bg-[#C89F6B]/8 rounded-full blur-3xl pointer-events-none" />

      {/* Header with Masked Word Reveal */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-10 sm:mb-12 text-center relative z-10">
        <MaskedHeading
          tag="h2"
          className="font-serif text-white text-3xl sm:text-4xl md:text-5xl lg:text-[46px] font-normal tracking-[0.08em] uppercase text-center leading-[1.15]"
        >
          REVIEW FROM OUR CUSTOMERS
        </MaskedHeading>
      </div>

      {/* 3-Column Vertical Infinite Marquee Grid with Scroll-Triggered Entrance & Feather Fade Mask */}
      <motion.div
        className="relative h-[520px] sm:h-[580px] max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-hidden"
        initial={{ opacity: 0, y: 32, filter: "blur(6px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 1.2, ease: LUXURY_EASE }}
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)",
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-7 h-full">
          {/* Column 1: Moves UP */}
          <div className="overflow-hidden h-full">
            <div className="animate-marquee-up gap-6">
              {col1.map((item, idx) => (
                <ReviewCard key={`col1-${idx}`} item={item} />
              ))}
            </div>
          </div>

          {/* Column 2: Moves DOWN (Center column moving in opposite direction) */}
          <div className="overflow-hidden h-full hidden md:block">
            <div className="animate-marquee-down gap-6">
              {col2.map((item, idx) => (
                <ReviewCard key={`col2-${idx}`} item={item} />
              ))}
            </div>
          </div>

          {/* Column 3: Moves UP */}
          <div className="overflow-hidden h-full hidden lg:block">
            <div className="animate-marquee-up gap-6">
              {col3.map((item, idx) => (
                <ReviewCard key={`col3-${idx}`} item={item} />
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
};
