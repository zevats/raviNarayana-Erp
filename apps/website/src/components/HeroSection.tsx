"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { MessageSquare, ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { siteConfig } from "@/data/siteConfig";
import { LUXURY_EASE } from "@/utils/motion";

const heroSlides = [
  {
    src: "/gallery/room-1.jpg",
    alt: "Executive Room with Dedicated Study and Work Desk",
  },
  {
    src: "/hero-bg.jpg",
    alt: "Ravinarayan PG Guesthouse Quiet Private Bedroom",
  },
  {
    src: "/gallery/bedroom-deluxe.jpg",
    alt: "Deluxe Single and Sharing Accommodations",
  },
  {
    src: "/gallery/room-4.jpg",
    alt: "Sunlit Room with Hygienic Bedding & Ventilation",
  },
];

interface HeroSectionProps {
  onOpenEnquiry?: (roomName?: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenEnquiry }) => {
  const shouldReduceMotion = useReducedMotion();
  const [activeSlide, setActiveSlide] = useState(0);
  const [incomingSlide, setIncomingSlide] = useState<number | null>(null);
  const [isSliding, setIsSliding] = useState(false);
  const isTransitioningRef = useRef(false);

  // Automatic right-to-left horizontal slideshow (smooth 2000ms transition, 4s display hold)
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let raf1: number;
    let raf2: number;
    let completeTimeoutId: NodeJS.Timeout;

    const scheduleNextSlide = () => {
      timeoutId = setTimeout(() => {
        if (document.hidden || isTransitioningRef.current) {
          scheduleNextSlide();
          return;
        }

        const nextIndex = (activeSlide + 1) % heroSlides.length;
        isTransitioningRef.current = true;
        setIncomingSlide(nextIndex);
        setIsSliding(false);

        raf1 = requestAnimationFrame(() => {
          raf2 = requestAnimationFrame(() => {
            setIsSliding(true);

            completeTimeoutId = setTimeout(() => {
              setActiveSlide(nextIndex);
              setIncomingSlide(null);
              setIsSliding(false);
              isTransitioningRef.current = false;
            }, 2000);
          });
        });
      }, 4000);
    };

    scheduleNextSlide();

    const handleVisibility = () => {
      if (document.hidden) {
        clearTimeout(timeoutId);
      } else if (!isTransitioningRef.current) {
        clearTimeout(timeoutId);
        scheduleNextSlide();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(timeoutId);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(completeTimeoutId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activeSlide]);

  return (
    <section className="relative min-h-[92vh] lg:min-h-screen flex items-center justify-center overflow-hidden bg-[#16221A] pt-24 sm:pt-28 pb-16 sm:pb-20">
      {/* Preload all slide images to prevent blank frames or flashing */}
      <div className="hidden" aria-hidden="true">
        {heroSlides.map((slide) => (
          <Image key={slide.src} src={slide.src} alt="" priority width={10} height={10} />
        ))}
      </div>

      {/* Genuine Right-to-Left Sliding Background Layers */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        {/* Layer 1: Outgoing / Active Slide */}
        <div
          className="absolute inset-0 w-full h-full will-change-transform"
          style={{
            transform: isSliding ? "translateX(-100%)" : "translateX(0%)",
            transition: isSliding ? "transform 2000ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
          }}
        >
          <Image
            src={heroSlides[activeSlide].src}
            alt={heroSlides[activeSlide].alt}
            fill
            priority
            sizes="100vw"
            className="object-cover object-center w-full h-full"
          />
        </div>

        {/* Layer 2: Incoming Slide (enters horizontally from right) */}
        {incomingSlide !== null && (
          <div
            className="absolute inset-0 w-full h-full will-change-transform"
            style={{
              transform: isSliding ? "translateX(0%)" : "translateX(100%)",
              transition: isSliding ? "transform 2000ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
            }}
          >
            <Image
              src={heroSlides[incomingSlide].src}
              alt={heroSlides[incomingSlide].alt}
              fill
              priority
              sizes="100vw"
              className="object-cover object-center w-full h-full"
            />
          </div>
        )}

        {/* Cinematic Neutral & Ambient Vignette (Crystal-clear, rich contrast matching Cabana & Oasila) */}
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/85 via-black/30 to-black/55 pointer-events-none" />
        <div className="absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.45)_100%)] pointer-events-none" />
      </div>

      {/* Hero Content Container — Focused, Grand & Editorial */}
      <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full pt-4 sm:pt-6 pb-12 sm:pb-16 text-center flex flex-col items-center">


        {/* Dominant Editorial Heading (Dual Directional Left/Right Floating Blur Entrance) */}
        <h1 className="font-serif text-white tracking-tight font-normal text-5xl sm:text-7xl md:text-8xl lg:text-[7.2rem] leading-[1.02] sm:leading-[1.01] mb-5 sm:mb-6 max-w-5xl mx-auto drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)]">
          <span className="block py-1">
            <motion.span
              className="inline-block"
              initial={
                shouldReduceMotion
                  ? { opacity: 1, x: 0, filter: "blur(0px)" }
                  : { x: -80, opacity: 0, filter: "blur(10px)" }
              }
              animate={{ x: 0, opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 1.45, delay: 0.18, ease: LUXURY_EASE }}
            >
              Your Stay,
            </motion.span>
          </span>
          <span className="block py-1">
            <motion.span
              className="italic font-light text-white/95 font-serif inline-block"
              initial={
                shouldReduceMotion
                  ? { opacity: 1, x: 0, filter: "blur(0px)" }
                  : { x: 80, opacity: 0, filter: "blur(10px)" }
              }
              animate={{ x: 0, opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 1.55, delay: 0.48, ease: LUXURY_EASE }}
            >
              Your Comfort.
            </motion.span>
          </span>
        </h1>

        {/* Immediate Business Explanation (Relaxed Calm Reveal) */}
        <motion.p
          className="text-base sm:text-lg md:text-xl text-white/85 max-w-2xl mx-auto font-light leading-relaxed mb-8 sm:mb-10 drop-shadow-md"
          initial={
            shouldReduceMotion
              ? { opacity: 1, y: 0, filter: "blur(0px)" }
              : { opacity: 0, y: 24, filter: "blur(6px)" }
          }
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.2, delay: 0.8, ease: LUXURY_EASE }}
        >
          Curated PG accommodation &amp; fresh home-style tiffin services in Met City &bull; Yakubpur &bull; Jhajjar.
        </motion.p>

        {/* Clean, Decisive Action CTAs */}
        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-5 w-full sm:w-auto mb-10 sm:mb-12"
          initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 1.05, ease: LUXURY_EASE }}
        >
          {/* Primary CTA — Crisp, Luminous Pill with Arrow (Cabana Style) */}
          <a
            href="#rooms"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-full bg-white hover:bg-white/95 text-[#1A2E20] font-semibold text-xs sm:text-sm tracking-wide transition-all duration-300 shadow-xl hover:shadow-2xl hover:-translate-y-0.5 group"
          >
            <span>Explore Rooms</span>
            <div className="w-6 h-6 rounded-full bg-[#1A2E20] text-white flex items-center justify-center group-hover:scale-105 transition-transform">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </a>

          {/* Secondary CTA — Refined Frosted Glass Pill with Emerald WhatsApp Icon */}
          <a
            href={siteConfig.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-full bg-black/30 hover:bg-black/45 border border-white/30 text-white font-medium text-xs sm:text-sm tracking-wide backdrop-blur-md transition-all duration-300 shadow-lg hover:-translate-y-0.5"
          >
            <MessageSquare className="w-4 h-4 text-emerald-400" />
            <span>Enquire on WhatsApp</span>
          </a>
        </motion.div>

        {/* Cabana-style Social Proof Trust Badge */}
        <motion.div
          className="inline-flex items-center gap-3.5 px-5 py-2.5 rounded-full bg-black/35 backdrop-blur-md border border-white/20 shadow-lg mb-6"
          initial={shouldReduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.05, delay: 1.28, ease: LUXURY_EASE }}
        >
          <div className="flex -space-x-2 overflow-hidden">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-800/80 border-2 border-[#16221A] text-[10px] font-bold text-white">R1</span>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#3D5240] border-2 border-[#16221A] text-[10px] font-bold text-white">R2</span>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#5D7656] border-2 border-[#16221A] text-[10px] font-bold text-white">R3</span>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-700 border-2 border-[#16221A] text-[10px] font-bold text-white">+80</span>
          </div>
          <p className="text-xs text-white/90 font-light text-left">
            Trusted by <strong className="font-semibold text-white">150+ working professionals</strong> &amp; scholars
          </p>
        </motion.div>
      </div>

      {/* Permanently Visible Oasila-style Mouse Scroll-Down Indicator (Clean White Outline) */}
      <motion.a
        href="#services"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("services")?.scrollIntoView({ behavior: "smooth" });
        }}
        aria-label="Scroll down to services"
        className="absolute bottom-8 sm:bottom-12 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 group cursor-pointer"
        initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.05, delay: 1.5, ease: LUXURY_EASE }}
      >
        <div className="w-5 h-8 rounded-full border border-white/60 group-hover:border-white transition-colors flex items-start justify-center pt-1.5 bg-black/25 backdrop-blur-sm shadow-md">
          <div className="w-1 h-2 rounded-full bg-white animate-mouse-wheel" />
        </div>
        <span className="text-[9px] sm:text-[10px] tracking-[0.25em] uppercase font-sans text-white/75 group-hover:text-white transition-colors">
          SCROLL DOWN
        </span>
      </motion.a>
    </section>
  );
};
