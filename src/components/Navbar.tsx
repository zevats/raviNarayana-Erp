"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Menu, X, Phone, ArrowUpRight, Sparkles } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

interface NavbarProps {
  onOpenEnquiry?: (roomName?: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenEnquiry }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 40) {
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

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          isScrolled || !isHome
            ? "bg-[#102A22]/95 backdrop-blur-md border-b border-sage/15 shadow-xl py-3.5"
            : "bg-gradient-to-b from-black/70 via-black/30 to-transparent py-5"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            {/* Brand Logo & Wordmark */}
            <Link
              href="/"
              className="flex items-center gap-3.5 group focus:outline-none"
              aria-label="Ravinarayan PG Guesthouse Home"
            >
              <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-full overflow-hidden border border-brass/40 shadow-md group-hover:scale-105 transition-transform duration-300 bg-forest-dark flex items-center justify-center">
                <Image
                  src="/logo.png"
                  alt="Ravinarayan Logo"
                  width={44}
                  height={44}
                  className="w-full h-full object-cover"
                  priority
                />
              </div>
              <div className="flex flex-col">
                <span className="font-serif text-xl sm:text-2xl font-bold tracking-wide text-ivory group-hover:text-brass transition-colors">
                  Ravinarayan
                </span>
                <span className="text-[10px] sm:text-[11px] tracking-widest uppercase font-medium text-sage/90">
                  PG Guesthouse &bull; Met City
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-1 lg:gap-2" aria-label="Main Navigation">
              {siteConfig.navLinks.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative px-4 py-2 text-sm font-medium tracking-wide transition-all rounded-full ${
                      isActive
                        ? "text-ivory bg-forest-light/60 font-semibold"
                        : "text-cream/80 hover:text-ivory hover:bg-white/5"
                    }`}
                  >
                    {item.name}
                    {isActive && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-brass" />
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Direct Contact & Primary CTA */}
            <div className="hidden lg:flex items-center gap-4">
              <a
                href={`tel:${siteConfig.phoneRaw}`}
                className="flex items-center gap-2 text-xs font-medium tracking-wider text-sage hover:text-ivory transition-colors py-2 px-3 rounded-lg hover:bg-white/5"
                title="Call Ravinarayan directly"
              >
                <Phone className="w-3.5 h-3.5 text-brass" />
                <span>{siteConfig.phone}</span>
              </a>

              <button
                type="button"
                onClick={() => (onOpenEnquiry ? onOpenEnquiry() : (window.location.href = "/contact"))}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brass hover:bg-brass-light text-forest-dark text-xs sm:text-sm font-bold tracking-wide transition-all duration-300 shadow-lg hover:shadow-brass/30 transform hover:-translate-y-0.5"
              >
                <span>Enquire About Rooms</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>

            {/* Mobile Hamburger Button */}
            <div className="flex md:hidden items-center gap-2">
              <a
                href={`tel:${siteConfig.phoneRaw}`}
                className="p-2 text-brass rounded-full bg-forest-dark border border-brass/30"
                aria-label="Call Ravinarayan"
              >
                <Phone className="w-4 h-4" />
              </a>

              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2.5 text-cream hover:text-ivory rounded-lg hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-brass"
                aria-label={mobileMenuOpen ? "Close menu" : "Open navigation menu"}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      <div
        className={`fixed inset-0 z-40 bg-black/70 backdrop-blur-md transition-opacity duration-300 md:hidden ${
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileMenuOpen(false)}
      />

      <aside
        className={`fixed top-0 right-0 bottom-0 w-full max-w-sm z-50 bg-[#102A22] border-l border-sage/20 p-6 flex flex-col justify-between shadow-2xl transition-transform duration-300 ease-out md:hidden ${
          mobileMenuOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Mobile Navigation"
      >
        <div>
          {/* Drawer Header */}
          <div className="flex items-center justify-between pb-6 border-b border-sage/15">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full overflow-hidden border border-brass/40 bg-forest-dark flex items-center justify-center">
                <Image src="/logo.png" alt="Ravinarayan" width={36} height={36} className="w-full h-full object-cover" />
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
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="mt-8 flex flex-col gap-2">
            {siteConfig.navLinks.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center justify-between px-4 py-3.5 rounded-xl text-base font-medium transition-all ${
                    isActive
                      ? "bg-forest-light text-ivory font-semibold border-l-4 border-brass"
                      : "text-cream/90 hover:bg-white/5 hover:text-ivory"
                  }`}
                >
                  <span>{item.name}</span>
                  {isActive && <Sparkles className="w-4 h-4 text-brass" />}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Drawer Footer Actions */}
        <div className="pt-6 border-t border-sage/15 flex flex-col gap-3">
          <a
            href={`tel:${siteConfig.phoneRaw}`}
            className="flex items-center justify-center gap-3 w-full py-3 rounded-xl border border-brass/40 text-cream font-medium text-sm hover:bg-brass/10 transition-colors"
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
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-brass hover:bg-brass-light text-forest-dark font-bold text-sm shadow-lg transition-transform active:scale-95"
          >
            <span>Enquire About Rooms</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>

          <p className="text-[11px] text-center text-sage/70 mt-2">
            Met City &bull; Yakubpur &bull; Jhajjar, Haryana
          </p>
        </div>
      </aside>
    </>
  );
};
