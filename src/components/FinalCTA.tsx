"use client";

import React from "react";
import { Phone, MessageSquare, MapPin, ArrowUpRight } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

interface FinalCTAProps {
  onOpenEnquiry?: (roomName?: string) => void;
}

export const FinalCTA: React.FC<FinalCTAProps> = ({ onOpenEnquiry }) => {
  return (
    <section id="connect" className="relative py-24 sm:py-32 bg-[#16221A] text-white overflow-hidden scroll-mt-20">
      {/* Decorative Botanical Ambient Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(142,159,137,0.12)_0%,transparent_70%)] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="border-b border-white/15 pb-8 mb-12 sm:mb-16 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-4 shadow-sm">
              <span>07 &bull; Connect With Management</span>
            </div>
            <h2 className="font-serif text-white text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-normal tracking-tight leading-[1.08]">
              Let&rsquo;s Connect <br className="hidden sm:inline" />
              <span className="italic font-light text-white/95">With Ravinarayan</span>
            </h2>
          </div>
          <p className="text-sm sm:text-base text-white/75 max-w-md font-light leading-relaxed">
            Whether you need a quiet executive room, affordable sharing accommodation, or fresh daily tiffin meal delivery, our management team is here to assist you.
          </p>
        </div>

        {/* 3-Card Connection Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-14">
          {/* Card 1: Visit */}
          <a
            href="#location"
            className="group relative rounded-3xl bg-[#1A2E20] border border-white/10 p-8 hover:border-white/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-8">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#A8B9A1] font-semibold">
                  Visit Us
                </span>
                <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white group-hover:bg-white group-hover:text-[#1A2E20] transition-all duration-300 transform group-hover:rotate-45">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
              </div>

              <div className="flex items-start gap-3 mb-4">
                <MapPin className="w-5 h-5 text-emerald-400 shrink-0 mt-1" />
                <h3 className="font-serif text-2xl font-medium text-white group-hover:text-emerald-300 transition-colors">
                  Met City &bull; Yakubpur
                </h3>
              </div>
            </div>

            <div className="pt-6 border-t border-white/10 text-xs text-white/70 leading-relaxed font-light">
              <p className="font-medium text-white mb-1">Jhajjar District, Haryana 124103</p>
              <p>Strategically situated near corporate business parks, industrial hubs, and transport links.</p>
            </div>
          </a>

          {/* Card 2: Call */}
          <a
            href={`tel:${siteConfig.phoneRaw}`}
            className="group relative rounded-3xl bg-[#1A2E20] border border-white/10 p-8 hover:border-white/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-8">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#A8B9A1] font-semibold">
                  Call Directly
                </span>
                <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white group-hover:bg-white group-hover:text-[#1A2E20] transition-all duration-300 transform group-hover:rotate-45">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
              </div>

              <div className="flex items-start gap-3 mb-4">
                <Phone className="w-5 h-5 text-emerald-400 shrink-0 mt-1" />
                <h3 className="font-serif text-2xl font-medium text-white group-hover:text-emerald-300 transition-colors">
                  {siteConfig.phone}
                </h3>
              </div>
            </div>

            <div className="pt-6 border-t border-white/10 text-xs text-white/70 leading-relaxed font-light">
              <p className="font-medium text-white mb-1">Direct Help Desk</p>
              <p>Speak with property staff for immediate room availability, custom sharing options, and tariffs.</p>
            </div>
          </a>

          {/* Card 3: WhatsApp */}
          <a
            href={siteConfig.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative rounded-3xl bg-[#1A2E20] border border-white/10 p-8 hover:border-emerald-500/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-8">
                <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-semibold">
                  Instant WhatsApp
                </span>
                <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white group-hover:bg-emerald-500 group-hover:text-white transition-all duration-300 transform group-hover:rotate-45">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
              </div>

              <div className="flex items-start gap-3 mb-4">
                <MessageSquare className="w-5 h-5 text-emerald-400 shrink-0 mt-1" />
                <h3 className="font-serif text-2xl font-medium text-white group-hover:text-emerald-300 transition-colors">
                  WhatsApp Support
                </h3>
              </div>
            </div>

            <div className="pt-6 border-t border-white/10 text-xs text-white/70 leading-relaxed font-light">
              <p className="font-medium text-white mb-1">Quick Photos &amp; Meal Plans</p>
              <p>Receive room photos, exact location pins, and tiffin meal trial menus straight to your phone.</p>
            </div>
          </a>
        </div>

        {/* Modal Enquiry Button Banner */}
        <div className="rounded-3xl bg-white/5 border border-white/10 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 backdrop-blur-md">
          <div className="text-center sm:text-left">
            <h4 className="font-serif text-xl sm:text-2xl font-medium text-white mb-1">
              Prefer a structured callback?
            </h4>
            <p className="text-xs sm:text-sm text-white/75 font-light">
              Submit your room preference or meal requirements, and we will contact you within 2 hours.
            </p>
          </div>

          <button
            type="button"
            onClick={() => (onOpenEnquiry ? onOpenEnquiry() : (window.location.href = "/contact"))}
            className="inline-flex items-center justify-center gap-3 px-8 py-4 rounded-full bg-white hover:bg-white/95 text-[#1A2E20] font-semibold text-xs sm:text-sm tracking-wide transition-all duration-300 shadow-xl hover:shadow-2xl hover:-translate-y-0.5 group shrink-0"
          >
            <span>Open Room Enquiry Form</span>
            <div className="w-6 h-6 rounded-full bg-[#1A2E20] text-white flex items-center justify-center group-hover:scale-105 transition-transform">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </button>
        </div>
      </div>
    </section>
  );
};
