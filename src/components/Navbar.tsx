"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Menu, X, Phone, ArrowUpRight } from "lucide-react";
import { motion, useScroll, useSpring } from "framer-motion";
import { siteConfig } from "@/data/siteConfig";

interface NavbarProps {
  onOpenEnquiry?: (roomName?: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenEnquiry }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  useEffect(() => {
    const handleScroll = () => {
      // Cabana Mountain scroll threshold: activates floating pill when scrolled past 50px
      if (window.scrollY > 50) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [mobileMenuOpen]);

  const isHome = pathname === "/";
  const showScrolledState = isScrolled || !isHome;

  return (
    <>
      {/* Subtle Editorial Scroll Progress Indicator */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[2px] bg-[#B58A57] origin-left z-50 pointer-events-none"
        style={{ scaleX }}
      />

      {/* 
        Outer Fixed Container:
        Fixed at top of viewport, pointer-events-none so surrounding margins don't block clicks.
        In scrolled state: provides generous floating top margin matching Cabana.
      */}
      <header
        className={`fixed top-0 left-0 right-0 z-40 flex justify-center pointer-events-none transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          showScrolledState
            ? "pt-4 sm:pt-6 px-4"
            : "pt-5 sm:pt-7 px-4 sm:px-6 lg:px-8"
        }`}
      >
        {/*
          Navbar Capsule Container:
          - At top: Full-width transparent editorial header over hero image, NO borders.
          - Scrolled: Compact 880px floating pill matching Cabana Mountain's exact proportions,
            translucent pale sage frosted glass, delicate border, and soft elevation.
        */}
        <div
          className={`pointer-events-auto w-full transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            showScrolledState
              ? "max-w-[920px] rounded-full bg-[#EEF1ED]/75 backdrop-blur-md border border-[#8E9F89]/25 shadow-[0_4px_24px_rgba(43,51,41,0.06)] px-5 sm:px-6 py-2 sm:py-2.5"
              : "max-w-7xl bg-transparent border-0 border-transparent rounded-none shadow-none px-0 py-1"
          }`}
        >
          <div className="flex items-center justify-between">
            {/* Brand Wordmark (Cabana-style pure serif typography) */}
            <Link
              href="/"
              className="flex items-center gap-2.5 group focus:outline-none"
              aria-label="Ravinarayan PG Guesthouse Home"
            >
              {/* Only show the round emblem at the top transparent state; keep the scrolled capsule sleek & typographic */}
              {!showScrolledState && (
                <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-full overflow-hidden border border-brass/40 bg-[#263B2D]/80 shadow-sm flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Image
                    src="/logo.png"
                    alt="Ravinarayan Logo"
                    width={36}
                    height={36}
                    className="w-full h-full object-cover"
                    priority
                  />
                </div>
              )}
              <span
                className={`font-serif text-xl sm:text-[25px] font-bold tracking-tight transition-colors duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  showScrolledState
                    ? "text-[#2B3329] group-hover:text-[#5D7656]"
                    : "text-ivory group-hover:text-brass"
                }`}
              >
                Ravinarayan
              </span>
            </Link>

            {/* Desktop Navigation Links — Centered, balanced, clean font, NO active dot */}
            <nav
              className="hidden md:flex items-center gap-6 lg:gap-7 xl:gap-8"
              aria-label="Main Navigation"
            >
              {siteConfig.navLinks.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative text-[13px] sm:text-[14px] tracking-normal transition-colors duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      showScrolledState
                        ? isActive
                          ? "text-[#2B3329] font-medium"
                          : "text-[#2B3329]/75 hover:text-[#5D7656] font-normal"
                        : isActive
                        ? "text-ivory font-semibold drop-shadow-sm"
                        : "text-ivory/80 hover:text-ivory font-normal drop-shadow-sm"
                    }`}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            {/* Primary CTA Action — Crisp White Pill with Dark Circular Arrow Icon (Cabana Mountain Style) */}
            <div className="hidden md:flex items-center">
              <button
                type="button"
                onClick={() =>
                  onOpenEnquiry ? onOpenEnquiry() : (window.location.href = "/contact")
                }
                className="inline-flex items-center gap-2.5 px-5 py-2 sm:py-2.5 rounded-full bg-white hover:bg-white/95 text-[#1A2E20] text-xs sm:text-sm font-semibold tracking-wide transition-all duration-300 shadow-md hover:shadow-lg hover:-translate-y-0.5 group"
              >
                <span>Enquire About Rooms</span>
                <div className="w-5 h-5 sm:w-5 sm:h-5 rounded-full bg-[#1A2E20] text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </div>
              </button>
            </div>

            {/* Mobile Actions: Phone & Hamburger */}
            <div className="flex md:hidden items-center gap-2">
              <a
                href={`tel:${siteConfig.phoneRaw}`}
                className={`p-1.5 sm:p-2 rounded-full transition-all duration-300 ${
                  showScrolledState
                    ? "text-[#2B3329] hover:bg-black/5"
                    : "text-brass bg-[#263B2D]/80 border border-brass/40"
                }`}
                aria-label="Call Ravinarayan"
              >
                <Phone className="w-4 h-4" />
              </a>

              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`p-1.5 sm:p-2 rounded-full transition-colors duration-300 focus:outline-none ${
                  showScrolledState
                    ? "text-[#2B3329] hover:bg-black/5"
                    : "text-ivory hover:bg-white/10"
                }`}
                aria-label={mobileMenuOpen ? "Close menu" : "Open navigation menu"}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? (
                  <X className="w-5 h-5 sm:w-6 sm:h-6" />
                ) : (
                  <Menu className="w-5 h-5 sm:w-6 sm:h-6" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden ${
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Mobile Drawer Menu — Refined, Minimal, NO Active Dot */}
      <aside
        className={`fixed top-0 right-0 bottom-0 w-full max-w-xs sm:max-w-sm z-50 bg-[#263B2D] border-l border-sage/20 p-6 flex flex-col justify-between shadow-2xl transition-transform duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden ${
          mobileMenuOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Mobile Navigation"
      >
        <div>
          {/* Drawer Header */}
          <div className="flex items-center justify-between pb-5 border-b border-sage/15">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full overflow-hidden border border-brass/40 bg-forest-dark flex items-center justify-center">
                <Image
                  src="/logo.png"
                  alt="Ravinarayan"
                  width={36}
                  height={36}
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <p className="font-serif text-lg font-bold text-ivory">Ravinarayan</p>
                <p className="text-[10px] uppercase tracking-wider text-sage">PG & Tiffin Service</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 text-sage hover:text-ivory rounded-full hover:bg-white/10 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Items — Clean typography, NO active dots, NO sparkles */}
          <nav className="mt-8 flex flex-col gap-2">
            {siteConfig.navLinks.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl text-base transition-colors duration-300 ${
                    isActive
                      ? "text-ivory font-semibold bg-white/10"
                      : "text-cream/80 hover:bg-white/5 hover:text-ivory font-normal"
                  }`}
                >
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Drawer Footer Actions */}
        <div className="pt-6 border-t border-sage/15 flex flex-col gap-3">
          <a
            href={`tel:${siteConfig.phoneRaw}`}
            className="flex items-center justify-center gap-3 w-full py-3 rounded-full border border-brass/40 text-cream font-medium text-sm hover:bg-brass/10 transition-colors"
          >
            <Phone className="w-4 h-4 text-brass" />
            <span>Call {siteConfig.phone}</span>
          </a>

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              if (onOpenEnquiry) {
                onOpenEnquiry();
              } else {
                window.location.href = "/contact";
              }
            }}
            className="flex items-center justify-center gap-2.5 w-full py-3.5 rounded-full bg-white hover:bg-white/95 text-[#1A2E20] font-semibold text-sm shadow-lg transition-transform active:scale-95"
          >
            <span>Enquire About Rooms</span>
            <div className="w-5 h-5 rounded-full bg-[#1A2E20] text-white flex items-center justify-center shrink-0">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </button>

          <p className="text-[11px] text-center text-sage/70 mt-1">
            Met City &bull; Yakubpur &bull; Jhajjar, Haryana
          </p>
        </div>
      </aside>
    </>
  );
};
