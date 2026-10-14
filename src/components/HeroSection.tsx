"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, Phone, Sparkles, MapPin, CheckCircle2 } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";
import { InteractiveScene } from "./InteractiveScene";

interface HeroSectionProps {
  onOpenEnquiry?: (roomName?: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenEnquiry }) => {
  return (
    <section className="relative min-h-[92vh] lg:min-h-screen flex items-center justify-center overflow-hidden bg-deep pt-24 pb-16">
      {/* Background Image with botanical depth overlay */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/hero-bg.jpg"
          alt="Ravinarayan PG Guesthouse Warm Interior"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center scale-105 transition-transform duration-1000 ease-out"
        />
        {/* Layered Botanical Gradients for Depth & Legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-deep via-deep/75 to-black/60" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(168,183,154,0.18),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_75%,rgba(181,138,87,0.15),transparent_60%)]" />
      </div>

      {/* Interactive 3D Ambient Botanical Particles */}
      <InteractiveScene />

      {/* Hero Content Container */}
      <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-12 md:py-20">
        <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
          {/* Botanical Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-forest-light/60 border border-sage/30 text-sage text-xs sm:text-sm font-medium tracking-wide backdrop-blur-md mb-6 animate-fade-in shadow-lg">
            <Sparkles className="w-3.5 h-3.5 text-brass" />
            <span>Botanical Calm &bull; Modern Co-Living in Haryana</span>
          </div>

          {/* Editorial Headline */}
          <h1 className="headline-hero font-serif text-ivory tracking-tight mb-6">
            A Better Place to{" "}
            <span className="italic font-normal text-cream underline decoration-brass/40 decoration-wavy underline-offset-8">
              Call Home
            </span>
          </h1>

          {/* Editorial Subtitle */}
          <p className="text-base sm:text-lg md:text-xl text-cream/90 max-w-2xl font-light leading-relaxed mb-10">
            Welcome to <strong className="text-ivory font-medium">Ravinarayan PG Guesthouse</strong>. Designed for working professionals and students seeking tranquil living, verified safety, and fresh home-style meals in Met City & Yakubpur.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto mb-12">
            <a
              href="#rooms"
              className="w-full sm:w-auto px-8 py-4 rounded-full bg-brass hover:bg-brass-light text-forest-dark font-bold text-sm tracking-wider uppercase transition-all duration-300 shadow-xl hover:shadow-brass/30 transform hover:-translate-y-0.5 text-center"
            >
              Explore Rooms
            </a>

            <a
              href={`tel:${siteConfig.phoneRaw}`}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-ivory font-semibold text-sm tracking-wide backdrop-blur-md transition-all duration-300 text-center"
            >
              <Phone className="w-4 h-4 text-brass" />
              <span>Call: {siteConfig.phone}</span>
            </a>
          </div>

          {/* Key Trust Pillars */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 pt-6 border-t border-sage/15 w-full max-w-3xl">
            <div className="flex items-center gap-2 text-left">
              <CheckCircle2 className="w-4 h-4 text-brass shrink-0" />
              <span className="text-xs sm:text-sm text-cream/80 font-medium">Single & Sharing</span>
            </div>
            <div className="flex items-center gap-2 text-left">
              <CheckCircle2 className="w-4 h-4 text-brass shrink-0" />
              <span className="text-xs sm:text-sm text-cream/80 font-medium">Daily Tiffin Service</span>
            </div>
            <div className="flex items-center gap-2 text-left">
              <CheckCircle2 className="w-4 h-4 text-brass shrink-0" />
              <span className="text-xs sm:text-sm text-cream/80 font-medium">24/7 CCTV Security</span>
            </div>
            <div className="flex items-center gap-2 text-left">
              <CheckCircle2 className="w-4 h-4 text-brass shrink-0" />
              <span className="text-xs sm:text-sm text-cream/80 font-medium">High-Speed Wi-Fi</span>
            </div>
          </div>
        </div>
      </div>

      {/* Down Scroll Indicator */}
      <a
        href="#story"
        aria-label="Scroll down to brand story"
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 text-sage/70 hover:text-ivory transition-colors group"
      >
        <span className="text-[10px] tracking-widest uppercase font-mono">Discover</span>
        <ArrowDown className="w-4 h-4 animate-bounce" />
      </a>
    </section>
  );
};
