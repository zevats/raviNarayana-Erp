"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { siteConfig } from "@/data/siteConfig";
import { LUXURY_EASE, staggerContainer, staggerItem, ruleExpand } from "@/utils/motion";
import { MaskedHeading } from "@/components/motion/MotionText";

export const UnifiedContact: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="contact"
      className="py-12 sm:py-16 bg-[#FAF8F5] text-[#263B2D] relative overflow-hidden"
    >
      {/* Subtle Ambient Botanical Glow */}
      <div className="absolute top-1/4 right-0 w-96 h-96 bg-[#5D7656]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-0 w-96 h-96 bg-[#C89F6B]/8 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* ============================================================== */}
        {/* SECTION HEADER (Matching Services We Offer Format)            */}
        {/* ============================================================== */}
        <div className="text-center mb-8 sm:mb-10">
          <motion.div
            className="flex items-center justify-center gap-4 mb-2.5"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.15 } },
            }}
          >
            <motion.span
              className="w-10 sm:w-16 h-[1px] bg-[#8E9F89]/50 origin-right inline-block"
              variants={ruleExpand}
            />
            <motion.span
              className="text-[11px] sm:text-xs uppercase tracking-[0.25em] font-serif text-[#5D7656] font-semibold"
              variants={{
                hidden: { opacity: 0, y: 14, filter: "blur(4px)" },
                visible: {
                  opacity: 1,
                  y: 0,
                  filter: "blur(0px)",
                  transition: { duration: 1.1, ease: LUXURY_EASE },
                },
              }}
            >
              GET IN TOUCH
            </motion.span>
            <motion.span
              className="w-10 sm:w-16 h-[1px] bg-[#8E9F89]/50 origin-left inline-block"
              variants={ruleExpand}
            />
          </motion.div>

          <MaskedHeading
            tag="h2"
            className="font-serif text-[#1A2E20] text-3xl sm:text-4xl md:text-5xl font-normal tracking-[0.06em] uppercase text-center"
          >
            LET&rsquo;S CONNECT
          </MaskedHeading>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center">
          
          {/* ============================================================== */}
          {/* LEFT PANEL: Square Satellite Map with Inset Frame Border       */}
          {/* ============================================================== */}
          <motion.div
            className="lg:col-span-6 w-full"
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: -28, scale: 0.97 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 1.2, ease: LUXURY_EASE }}
          >
            <a
              href="https://maps.google.com/?q=Met+City+Yakubpur+Jhajjar+Haryana"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Ravinarayan PG Guesthouse Location on Google Maps"
              className="relative h-[360px] sm:h-[400px] lg:h-[440px] w-full border border-[#263B2D]/20 shadow-lg bg-[#141C16] group overflow-hidden block cursor-pointer"
            >
              {/* Google Maps Embed with Satellite View as Default (t=k) and Zoom Effect on Hover */}
              <div className="w-full h-full overflow-hidden">
                <iframe
                  title="Ravinarayan PG Guesthouse Satellite View"
                  src="https://maps.google.com/maps?q=Met+City+Yakubpur+Jhajjar+Haryana&t=k&z=15&ie=UTF8&iwloc=&output=embed"
                  className="w-full h-full border-0 filter contrast-[1.05] pointer-events-none transition-transform duration-700 ease-out group-hover:scale-105"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>

              {/* Inset Hairline Inside Border (Matching Reference Framed Style) */}
              <div className="absolute inset-3 sm:inset-4 border border-white/60 pointer-events-none z-10 shadow-[0_0_0_1px_rgba(0,0,0,0.15)]" />

              {/* Discrete Square Satellite Action Tag */}
              <div className="absolute bottom-6 right-6 z-20 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-black/80 group-hover:bg-black text-white text-[11px] font-mono tracking-wider uppercase border border-white/30 backdrop-blur-sm transition-colors">
                <span>Open Map</span>
                <ArrowUpRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </a>
          </motion.div>

          {/* ============================================================== */}
          {/* RIGHT PANEL: Refined Editorial Matrix (Visit, Write, Call)    */}
          {/* ============================================================== */}
          <motion.div
            className="lg:col-span-6 flex flex-col justify-center space-y-2 sm:space-y-3"
            initial={shouldReduceMotion ? "visible" : "hidden"}
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={staggerContainer(0.16, 0.1)}
          >
            
            {/* ROW 1: VISIT */}
            <motion.a
              variants={staggerItem}
              href="https://maps.google.com/?q=Met+City+Yakubpur+Jhajjar+Haryana"
              target="_blank"
              rel="noopener noreferrer"
              className="py-4 sm:py-5 border-b border-[#263B2D]/10 group transition-colors block"
            >
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-6 items-center">
                <div className="sm:col-span-4">
                  <span className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-[#1A2E20] group-hover:text-[#5D7656] transition-colors block">
                    Visit
                  </span>
                </div>

                <div className="hidden sm:flex sm:col-span-2 items-center text-[#8E9F89] group-hover:text-[#1A2E20] group-hover:translate-x-2 transition-all">
                  <ArrowRight className="w-5 h-5 stroke-[1.5]" />
                </div>

                <div className="sm:col-span-6 space-y-0.5">
                  <p className="font-serif text-base sm:text-lg text-[#1A2E20] font-medium leading-snug">
                    Met City &bull; Yakubpur
                  </p>
                  <p className="text-xs sm:text-sm text-[#263B2D]/70 font-light leading-relaxed">
                    Jhajjar, Haryana 124103, India
                  </p>
                </div>
              </div>
            </motion.a>

            {/* ROW 2: WRITE / WHATSAPP */}
            <motion.a
              variants={staggerItem}
              href={siteConfig.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-4 sm:py-5 border-b border-[#263B2D]/10 group transition-colors block"
            >
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-6 items-center">
                <div className="sm:col-span-4">
                  <span className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-[#1A2E20] group-hover:text-[#5D7656] transition-colors block">
                    Write
                  </span>
                </div>

                <div className="hidden sm:flex sm:col-span-2 items-center text-[#8E9F89] group-hover:text-[#1A2E20] group-hover:translate-x-2 transition-all">
                  <ArrowRight className="w-5 h-5 stroke-[1.5]" />
                </div>

                <div className="sm:col-span-6 space-y-0.5">
                  <p className="font-serif text-base sm:text-lg text-[#1A2E20] font-medium leading-snug">
                    WhatsApp: {siteConfig.phone}
                  </p>
                  <p className="text-xs sm:text-sm text-[#263B2D]/70 font-light leading-relaxed">
                    Direct Concierge &bull; Instant Vacancies &amp; Menu
                  </p>
                </div>
              </div>
            </motion.a>

            {/* ROW 3: CALL */}
            <motion.a
              variants={staggerItem}
              href={`tel:${siteConfig.phoneRaw}`}
              className="py-4 sm:py-5 border-b border-[#263B2D]/10 group transition-colors block"
            >
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-6 items-center">
                <div className="sm:col-span-4">
                  <span className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-[#1A2E20] group-hover:text-[#5D7656] transition-colors block">
                    Call
                  </span>
                </div>

                <div className="hidden sm:flex sm:col-span-2 items-center text-[#8E9F89] group-hover:text-[#1A2E20] group-hover:translate-x-2 transition-all">
                  <ArrowRight className="w-5 h-5 stroke-[1.5]" />
                </div>

                <div className="sm:col-span-6 space-y-0.5">
                  <p className="font-serif text-base sm:text-lg text-[#1A2E20] font-medium leading-snug">
                    {siteConfig.phone}
                  </p>
                  <p className="text-xs sm:text-sm text-[#263B2D]/70 font-light leading-relaxed">
                    Property Management &bull; 8:00 AM &ndash; 10:00 PM
                  </p>
                </div>
              </div>
            </motion.a>

            {/* Bottom FAQ & Full Contact Link */}
            <motion.div variants={staggerItem} className="pt-3">
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 text-xs uppercase font-mono tracking-widest font-semibold text-[#1A2E20] hover:text-[#5D7656] transition-colors group"
              >
                <span>Open Full Contact &amp; FAQ Page</span>
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            </motion.div>

          </motion.div>
        </div>
      </div>
    </section>
  );
};
