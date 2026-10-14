"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Phone,
  MapPin,
  Wifi,
  Droplets,
  ShieldCheck,
  UtensilsCrossed,
  Shirt,
  Users,
  Instagram,
  ArrowUpRight,
  Heart,
} from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export const Footer: React.FC = () => {
  return (
    <footer className="bg-[#0B1E18] text-ivory border-t border-sage/15 pt-16 sm:pt-20 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Main Footer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-12 pb-14 border-b border-sage/15">
          {/* Brand & Mission (4 cols) */}
          <div className="lg:col-span-4 space-y-5">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-11 h-11 rounded-full overflow-hidden border border-brass/40 bg-forest-dark flex items-center justify-center">
                <Image
                  src="/logo.png"
                  alt="Ravinarayan PG Guesthouse"
                  width={44}
                  height={44}
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <span className="font-serif text-2xl font-bold tracking-wide text-ivory group-hover:text-brass transition-colors">
                  Ravinarayan
                </span>
                <p className="text-[10px] tracking-widest uppercase font-mono text-sage">
                  PG Guesthouse &bull; Haryana
                </p>
              </div>
            </Link>

            <p className="text-sm text-cream/70 leading-relaxed max-w-sm">
              Providing quiet, secure, and respectful PG accommodation and fresh home-style tiffin meal delivery for working professionals and students in Met City, Yakubpur, and Jhajjar.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <a
                href={siteConfig.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-forest-dark border border-sage/20 flex items-center justify-center text-sage hover:text-ivory hover:border-brass transition-colors"
                aria-label="Ravinarayan Instagram"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href={siteConfig.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-full bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 text-xs font-medium hover:bg-emerald-800 transition-colors flex items-center gap-1.5"
              >
                <span>WhatsApp Helpline</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Quick Links (2 cols) */}
          <div className="lg:col-span-2 space-y-4">
            <p className="text-xs uppercase font-mono tracking-widest text-brass font-bold">
              Navigation
            </p>
            <ul className="space-y-2.5 text-sm">
              {siteConfig.navLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-cream/70 hover:text-ivory hover:underline underline-offset-4 transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={siteConfig.tiffinPortalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-cream/70 hover:text-brass transition-colors"
                >
                  <span>Tiffin Service Portal</span>
                  <ArrowUpRight className="w-3 h-3 text-brass" />
                </a>
              </li>
            </ul>
          </div>

          {/* Verified Facilities (3 cols) */}
          <div className="lg:col-span-3 space-y-4">
            <p className="text-xs uppercase font-mono tracking-widest text-brass font-bold">
              Verified Facilities
            </p>
            <ul className="space-y-2.5 text-xs text-cream/80">
              <li className="flex items-center gap-2">
                <Wifi className="w-3.5 h-3.5 text-sage" />
                <span>High-Speed Internet (Wi-Fi)</span>
              </li>
              <li className="flex items-center gap-2">
                <Droplets className="w-3.5 h-3.5 text-sage" />
                <span>RO Purified Drinking Water</span>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-sage" />
                <span>24/7 CCTV Campus Security</span>
              </li>
              <li className="flex items-center gap-2">
                <UtensilsCrossed className="w-3.5 h-3.5 text-sage" />
                <span>Daily Fresh Food Service</span>
              </li>
              <li className="flex items-center gap-2">
                <Shirt className="w-3.5 h-3.5 text-sage" />
                <span>Laundry Facilities Included</span>
              </li>
              <li className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-sage" />
                <span>Respectful Community Living</span>
              </li>
            </ul>
          </div>

          {/* Contact & Service Areas (3 cols) */}
          <div className="lg:col-span-3 space-y-4">
            <p className="text-xs uppercase font-mono tracking-widest text-brass font-bold">
              Service Locations &amp; Contact
            </p>
            <div className="space-y-3 text-xs text-cream/80">
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-brass shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-ivory">Met City &bull; Yakubpur</p>
                  <p className="text-sage">Jhajjar, Haryana, India</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Phone className="w-4 h-4 text-brass shrink-0 mt-0.5" />
                <div>
                  <a
                    href={`tel:${siteConfig.phoneRaw}`}
                    className="text-ivory hover:text-brass font-bold text-sm transition-colors"
                  >
                    {siteConfig.phone}
                  </a>
                  <p className="text-[11px] text-sage">Call for room availability</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Bottom Bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-sage/70 gap-4">
          <p>
            &copy; {new Date().getFullYear()} {siteConfig.name}. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <span>Met City &bull; Yakubpur &bull; Jhajjar</span>
            <span>Botanical Luxury Living</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
