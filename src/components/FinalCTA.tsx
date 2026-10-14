"use client";

import React from "react";
import { Phone, MessageSquare, ArrowUpRight, Sparkles } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

interface FinalCTAProps {
  onOpenEnquiry?: (roomName?: string) => void;
}

export const FinalCTA: React.FC<FinalCTAProps> = ({ onOpenEnquiry }) => {
  return (
    <section className="relative py-20 sm:py-28 bg-[#0E241D] text-ivory overflow-hidden">
      {/* Decorative Botanical Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(181,138,87,0.15),transparent_70%)] pointer-events-none" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-forest-light/60 border border-brass/30 text-brass text-xs font-mono uppercase tracking-wider mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Your Home Away From Home</span>
        </div>

        {/* Editorial Heading */}
        <h2 className="headline-display font-serif font-bold text-ivory tracking-tight mb-6 max-w-3xl mx-auto">
          Experience Peaceful, Well-Managed Living in Met City &amp; Yakubpur.
        </h2>

        {/* Description */}
        <p className="text-base sm:text-lg text-cream/90 max-w-2xl mx-auto mb-10 leading-relaxed font-light">
          Whether you need a quiet single room, affordable sharing accommodation, or hot daily tiffin meals, we are ready to welcome you.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto">
          <a
            href={`tel:${siteConfig.phoneRaw}`}
            className="w-full sm:w-auto px-8 py-4 rounded-full bg-brass hover:bg-brass-light text-forest-dark font-bold text-xs sm:text-sm tracking-wider uppercase transition-all duration-300 shadow-xl flex items-center justify-center gap-2"
          >
            <Phone className="w-4 h-4" />
            <span>Call: {siteConfig.phone}</span>
          </a>

          <a
            href={siteConfig.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-8 py-4 rounded-full bg-forest-light hover:bg-white/10 border border-sage/30 text-ivory font-semibold text-xs sm:text-sm tracking-wide transition-all duration-300 flex items-center justify-center gap-2"
          >
            <MessageSquare className="w-4 h-4 text-emerald-400" />
            <span>WhatsApp Enquiry</span>
          </a>
        </div>
      </div>
    </section>
  );
};
