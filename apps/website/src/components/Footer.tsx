"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { siteConfig } from "@/data/siteConfig";
import { LUXURY_EASE, staggerContainer, staggerItem } from "@/utils/motion";

export const Footer: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();
  const [inquiryText, setInquiryText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = inquiryText.trim()
      ? `Hello Ravinarayan Team, I would like to stay in the know / enquire regarding: ${inquiryText.trim()}`
      : "Hello Ravinarayan Team, I would like to stay in the know about room vacancies and daily tiffin plans.";
    window.open(`https://wa.me/918571801102?text=${encodeURIComponent(query)}`, "_blank");
  };

  return (
    <footer className="bg-[#121A15] text-white border-t border-white/10 pt-20 pb-16 sm:pt-24 sm:pb-20 relative overflow-hidden">
      {/* Subtle Ambient Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-48 bg-[#5D7656]/10 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center space-y-12 sm:space-y-14"
        initial={shouldReduceMotion ? "visible" : "hidden"}
        whileInView="visible"
        viewport={{ once: true, margin: "-40px" }}
        variants={staggerContainer(0.16, 0.08)}
      >
        
        {/* ============================================================== */}
        {/* TOP HERO HEADLINE & INQUIRY BAR (Oasila Luxury Style)          */}
        {/* ============================================================== */}
        <motion.div variants={staggerItem} className="space-y-5 max-w-2xl mx-auto">
          <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl font-normal tracking-tight text-white leading-tight">
            Stay in the know
          </h2>
          <p className="text-sm sm:text-base text-white/70 font-light leading-relaxed max-w-lg mx-auto">
            Be the first to know about verified room vacancies, seasonal tiffin menus, and campus accommodation updates.
          </p>

          {/* Centered Luxury Input Pill Bar */}
          <div className="pt-3 max-w-md mx-auto">
            <form
              onSubmit={handleSubmit}
              className="relative flex items-center bg-white rounded-full p-1.5 shadow-2xl transition-all focus-within:ring-2 focus-within:ring-white/40"
            >
              <input
                type="text"
                value={inquiryText}
                onChange={(e) => setInquiryText(e.target.value)}
                placeholder="Enter your email or WhatsApp number"
                className="w-full pl-6 pr-14 py-3 bg-transparent text-[#1A2E20] placeholder-[#8E9F89] text-xs sm:text-sm font-light focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Connect via WhatsApp"
                className="absolute right-1.5 top-1.5 bottom-1.5 w-11 h-11 bg-[#263B2D] hover:bg-[#1A2E20] text-white rounded-full flex items-center justify-center transition-all group shrink-0"
              >
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </form>
          </div>
        </motion.div>

        {/* ============================================================== */}
        {/* CENTERED HORIZONTAL NAVIGATION (Pipe-Separated Editorial Links) */}
        {/* ============================================================== */}
        <motion.div variants={staggerItem} className="pt-4 pb-2 border-t border-white/10">
          <nav
            aria-label="Footer Navigation"
            className="flex flex-wrap items-center justify-center gap-y-3 gap-x-3 sm:gap-x-5 text-xs sm:text-sm uppercase tracking-widest text-white/80 font-mono font-medium"
          >
            <Link
              href="/"
              className="hover:text-white hover:underline underline-offset-8 transition-colors"
            >
              Home
            </Link>
            <span className="text-white/20 select-none">|</span>
            <Link
              href="/about"
              className="hover:text-white hover:underline underline-offset-8 transition-colors"
            >
              About Us
            </Link>
            <span className="text-white/20 select-none">|</span>
            <Link
              href="/rooms"
              className="hover:text-white hover:underline underline-offset-8 transition-colors"
            >
              Rooms
            </Link>
            <span className="text-white/20 select-none">|</span>
            <Link
              href="/tiffin-service"
              className="hover:text-white hover:underline underline-offset-8 transition-colors"
            >
              Tiffin Service
            </Link>
            <span className="text-white/20 select-none">|</span>
            <Link
              href="/contact"
              className="hover:text-white hover:underline underline-offset-8 transition-colors"
            >
              Contact
            </Link>
          </nav>
        </motion.div>

        {/* ============================================================== */}
        {/* BOTTOM METADATA & COPYRIGHT                                    */}
        {/* ============================================================== */}
        <motion.div variants={staggerItem} className="pt-4 space-y-2 text-xs text-white/50 font-light">
          <p className="font-mono text-[11px] tracking-widest uppercase text-[#A8B9A1]">
            Met City &bull; Yakubpur &bull; Jhajjar, Haryana
          </p>
          <p>
            Copyright &copy; {new Date().getFullYear()} {siteConfig.name}. All Rights Reserved.
          </p>
        </motion.div>

      </motion.div>
    </footer>
  );
};
