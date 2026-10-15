"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { siteConfig } from "@/data/siteConfig";
import { LUXURY_EASE, staggerContainer, staggerItem, ruleExpand } from "@/utils/motion";
import { MaskedHeading } from "@/components/motion/MotionText";
import { ScrollDepth } from "@/components/motion/ScrollDepth";

export const ServicesSection: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="services"
      className="relative py-20 sm:py-24 bg-[#FAF8F5] text-[#263B2D] overflow-hidden scroll-mt-20"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Subtitle Block for Core Services (Matching Resorto Reference Style) */}
        <motion.div
          className="flex items-center justify-center gap-4 mb-3.5"
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
            SERVICES WE OFFER
          </motion.span>
          <motion.span
            className="w-10 sm:w-16 h-[1px] bg-[#8E9F89]/50 origin-left inline-block"
            variants={ruleExpand}
          />
        </motion.div>

        {/* Masked Editorial Heading Reveal */}
        <MaskedHeading
          tag="h2"
          className="font-serif text-[#1A2E20] text-3xl sm:text-4xl md:text-5xl font-normal tracking-[0.06em] uppercase text-center mb-12 sm:mb-16"
        >
          DISCOVER OUR LIVING SERVICES
        </MaskedHeading>

        {/* Service 1: PG Accommodation */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center mb-16 sm:mb-20">
          {/* Photo with Masked Slide & Subtle 2.5D Depth */}
          <motion.div
            className="lg:col-span-7"
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: -30, scale: 0.96 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 1.25, ease: LUXURY_EASE }}
          >
            <div className="relative aspect-[16/11] rounded-2xl sm:rounded-3xl overflow-hidden shadow-xl border border-[#8E9F89]/25 bg-[#EAE5D9] group">
              <ScrollDepth depth={16}>
                <div className="relative w-full aspect-[16/11]">
                  <Image
                    src="/gallery/room-1.jpg"
                    alt="Ravinarayan PG Accommodation Rooms"
                    fill
                    sizes="(max-width: 1024px) 100vw, 55vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                </div>
              </ScrollDepth>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none z-10" />
              <div className="absolute bottom-6 left-6 right-6 text-white flex items-center justify-between z-10">
                <div>
                  <span className="text-[10px] uppercase font-serif tracking-[0.2em] text-[#DCE5D7] block mb-1">
                    Met City &bull; Yakubpur
                  </span>
                  <p className="font-serif text-lg sm:text-xl font-normal text-white">
                    Single &amp; Double Sharing Living Spaces
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Details Column with Editorial Stagger */}
          <motion.div
            className="lg:col-span-5 space-y-6"
            initial={shouldReduceMotion ? "visible" : "hidden"}
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={staggerContainer(0.16, 0.1)}
          >
            <motion.div
              variants={staggerItem}
              className="text-[11px] uppercase tracking-[0.2em] font-serif text-[#5D7656] font-semibold"
            >
              ACCOMMODATION &bull; RESIDENCE
            </motion.div>
            
            <motion.h4
              variants={staggerItem}
              className="font-serif text-[#1A2E20] text-2xl sm:text-3xl md:text-4xl font-normal leading-snug"
            >
              Comfortable single and sharing rooms for working professionals and students.
            </motion.h4>

            <motion.p
              variants={staggerItem}
              className="text-[#4A584E] text-sm sm:text-base leading-relaxed font-light"
            >
              Designed for residents who value tranquility, focus, and security. Every accommodation includes high-speed fiber Wi-Fi, 24/7 RO purified water, continuous CCTV surveillance, and supportive bedding.
            </motion.p>

            <motion.ul
              variants={staggerItem}
              className="space-y-2.5 pt-2 border-t border-[#8E9F89]/20 text-xs sm:text-sm text-[#263B2D]"
            >
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5D7656]" />
                <span>Dedicated personal study desks and storage wardrobes</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5D7656]" />
                <span>Enterprise high-speed fiber internet in every bedroom</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5D7656]" />
                <span>Multi-stage RO drinking water dispensers on all floors</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5D7656]" />
                <span>Continuous HD security cameras across gates and hallways</span>
              </li>
            </motion.ul>

            <motion.div variants={staggerItem} className="pt-4 flex items-center gap-4">
              <Link
                href="/rooms"
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-full bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-serif tracking-widest uppercase transition-all shadow-md hover:shadow-lg group"
              >
                <span>Explore Rooms</span>
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            </motion.div>
          </motion.div>
        </div>

        {/* Service 2: Fresh Tiffin Service */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Details (Left on Desktop) */}
          <motion.div
            className="lg:col-span-5 space-y-6 order-2 lg:order-1"
            initial={shouldReduceMotion ? "visible" : "hidden"}
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={staggerContainer(0.16, 0.1)}
          >
            <motion.div
              variants={staggerItem}
              className="text-[11px] uppercase tracking-[0.2em] font-serif text-[#5D7656] font-semibold"
            >
              CULINARY &bull; DAILY MEALS
            </motion.div>
            
            <motion.h4
              variants={staggerItem}
              className="font-serif text-[#1A2E20] text-2xl sm:text-3xl md:text-4xl font-normal leading-snug"
            >
              Fresh, home-style meals prepared for convenient everyday living.
            </motion.h4>

            <motion.p
              variants={staggerItem}
              className="text-[#4A584E] text-sm sm:text-base leading-relaxed font-light"
            >
              Wholesome vegetarian meals cooked daily in a clean, hygienic kitchen with RO water and fresh ingredients. Served hot for breakfast, lunch, and dinner with flexible monthly and trial meal plans.
            </motion.p>

            <motion.ul
              variants={staggerItem}
              className="space-y-2.5 pt-2 border-t border-[#8E9F89]/20 text-xs sm:text-sm text-[#263B2D]"
            >
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5D7656]" />
                <span><strong>Breakfast (7:30 – 9:30 AM):</strong> Fresh rotis, parathas &amp; tea</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5D7656]" />
                <span><strong>Lunch (12:30 – 2:30 PM):</strong> Full thali with sabzi, dal &amp; rice</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5D7656]" />
                <span><strong>Dinner (7:30 – 9:30 PM):</strong> Light home-cooked comforting fare</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5D7656]" />
                <span>100% RO filtered water cooking &bull; Zero reused oils</span>
              </li>
            </motion.ul>

            <motion.div variants={staggerItem} className="pt-4 flex flex-wrap items-center gap-4">
              <Link
                href="/tiffin-service"
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-full bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-serif tracking-widest uppercase transition-all shadow-md hover:shadow-lg group"
              >
                <span>Explore Tiffin Service</span>
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>

              <a
                href={siteConfig.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-4 rounded-full border border-[#8E9F89]/40 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-serif tracking-wider uppercase transition-all shadow-xs"
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
                <span>Enquire on WhatsApp</span>
              </a>
            </motion.div>
          </motion.div>

          {/* Photo (Right on Desktop) with Masked Slide & Subtle 2.5D Depth */}
          <motion.div
            className="lg:col-span-7 order-1 lg:order-2"
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: 30, scale: 0.96 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 1.25, ease: LUXURY_EASE }}
          >
            <div className="relative aspect-[16/11] rounded-2xl sm:rounded-3xl overflow-hidden shadow-xl border border-[#8E9F89]/25 bg-[#EAE5D9] group">
              <ScrollDepth depth={16}>
                <div className="relative w-full aspect-[16/11]">
                  <Image
                    src="/gallery/tiffin.png"
                    alt="Ravinarayan Fresh Daily Tiffin Service"
                    fill
                    sizes="(max-width: 1024px) 100vw, 55vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                </div>
              </ScrollDepth>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none z-10" />
              <div className="absolute bottom-6 left-6 right-6 text-white flex items-center justify-between z-10">
                <div>
                  <span className="text-[10px] uppercase font-serif tracking-[0.2em] text-[#DCE5D7] block mb-1">
                    Pure Vegetarian &bull; RO Cooked
                  </span>
                  <p className="font-serif text-lg sm:text-xl font-normal text-white">
                    Nutritious &amp; Balanced Home-Style Meals
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

      </div>
    </section>
  );
};
