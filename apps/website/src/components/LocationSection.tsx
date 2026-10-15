"use client";

import React, { useState } from "react";
import { MapPin, Phone, MessageSquare, Navigation, Check, Send } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export const LocationSection: React.FC = () => {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("Single Room PG");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;

    const query = encodeURIComponent(
      `*General Enquiry via Website*\nName: ${name || "Guest"}\nPhone: ${phone}\nPurpose: ${purpose}\nMessage: ${message || "Interested in services"}`
    );
    window.open(`https://wa.me/918571801102?text=${query}`, "_blank");
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  };

  return (
    <section id="location" className="relative py-24 sm:py-32 bg-[#FAF8F5] text-[#263B2D] overflow-hidden scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="max-w-3xl mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#5D7656]/20 bg-[#5D7656]/10 text-[#263B2D] text-[11px] font-sans tracking-[0.2em] uppercase font-semibold mb-3 shadow-sm">
            <span>06 &bull; Strategic Location &amp; Contact</span>
          </div>
          <h2 className="font-serif text-[#1A2E20] text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-normal tracking-tight leading-[1.08]">
            Serving Met City, <br className="hidden sm:inline" />
            <span className="italic font-light">Yakubpur &amp; Jhajjar</span>
          </h2>
          <p className="mt-3 text-[#4A584E] text-base sm:text-lg leading-relaxed font-light">
            Positioned conveniently for executives, project managers, and scholars seeking quiet residential comfort near major workplaces.
          </p>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
          {/* Left Column: Direct Contact & Location Highlights */}
          <div className="lg:col-span-5 space-y-6">
            {/* Phone Card */}
            <div className="p-6 rounded-3xl bg-white border border-[#8E9F89]/20 shadow-md flex items-start gap-4 hover:shadow-xl transition-all">
              <div className="p-3.5 rounded-2xl bg-[#1A2E20] text-white shrink-0 shadow-sm">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-mono tracking-wider text-[#5E715C] font-semibold">Direct Help Desk</p>
                <a
                  href={`tel:${siteConfig.phoneRaw}`}
                  className="font-serif text-2xl font-bold text-[#1A2E20] hover:text-[#5D7656] transition-colors block mt-0.5"
                >
                  {siteConfig.phone}
                </a>
                <p className="text-xs text-[#5E715C] mt-1 font-light">Available daily for room bookings &amp; meal inquiries</p>
              </div>
            </div>

            {/* WhatsApp Card */}
            <div className="p-6 rounded-3xl bg-white border border-[#8E9F89]/20 shadow-md flex items-start gap-4 hover:shadow-xl transition-all">
              <div className="p-3.5 rounded-2xl bg-emerald-700 text-white shrink-0 shadow-sm">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-mono tracking-wider text-emerald-800 font-semibold">Official WhatsApp</p>
                <a
                  href={siteConfig.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-serif text-xl font-bold text-[#1A2E20] hover:text-emerald-700 transition-colors block mt-0.5"
                >
                  Chat with Management
                </a>
                <p className="text-xs text-[#5E715C] mt-1 font-light">Instant responses for vacancy &amp; on-site visits</p>
              </div>
            </div>

            {/* Area Overview */}
            <div className="p-6 rounded-3xl bg-white border border-[#8E9F89]/20 shadow-md space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#5D7656]/10 flex items-center justify-center text-[#263B2D]">
                  <MapPin className="w-4 h-4" />
                </div>
                <h3 className="font-serif font-bold text-[#1A2E20] text-lg">Location Area</h3>
              </div>
              <p className="text-sm text-[#4A584E] leading-relaxed font-light">
                Ravinarayan PG Guesthouse is situated in the <strong className="text-[#1A2E20] font-semibold">Met City / Yakubpur</strong> cluster, serving residents across <strong className="text-[#1A2E20] font-semibold">Jhajjar, Haryana</strong>.
              </p>
              <div className="pt-3 border-t border-[#8E9F89]/20 flex items-center justify-between">
                <span className="text-xs text-[#5E715C] font-mono">State of Haryana &bull; India</span>
                <a
                  href="https://maps.google.com/?q=Met+City+Yakubpur+Jhajjar+Haryana"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1A2E20] hover:text-[#5D7656] transition-colors"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Open in Google Maps</span>
                </a>
              </div>
            </div>
          </div>

          {/* Right Column: Direct Message Form */}
          <div className="lg:col-span-7 bg-white rounded-3xl p-8 sm:p-10 border border-[#8E9F89]/20 shadow-xl">
            <h3 className="font-serif text-2xl sm:text-3xl font-medium text-[#1A2E20] mb-2">
              Send an Enquiry
            </h3>
            <p className="text-sm text-[#4A584E] mb-8 font-light">
              Fill in your details below. We will connect with you directly via phone or WhatsApp.
            </p>

            {sent ? (
              <div className="p-8 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-3">
                <Check className="w-10 h-10 text-emerald-600 mx-auto" />
                <h4 className="font-serif text-xl font-bold text-[#1A2E20]">Enquiry Ready!</h4>
                <p className="text-sm text-[#4A584E]">
                  Opening WhatsApp to finalize your inquiry with the Ravinarayan team...
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs uppercase font-mono tracking-wider text-[#1A2E20] font-semibold mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Amit Kumar"
                      className="w-full px-4 py-3.5 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/30 text-[#1A2E20] placeholder-[#5E715C]/60 text-sm focus:border-[#1A2E20] focus:outline-none focus:ring-1 focus:ring-[#1A2E20] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-mono tracking-wider text-[#1A2E20] font-semibold mb-2">
                      Phone Number *
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full px-4 py-3.5 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/30 text-[#1A2E20] placeholder-[#5E715C]/60 text-sm focus:border-[#1A2E20] focus:outline-none focus:ring-1 focus:ring-[#1A2E20] transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase font-mono tracking-wider text-[#1A2E20] font-semibold mb-2">
                    Enquiry Category
                  </label>
                  <select
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/30 text-[#1A2E20] text-sm focus:border-[#1A2E20] focus:outline-none focus:ring-1 focus:ring-[#1A2E20] transition-colors"
                  >
                    <option value="Single Room PG">Single Room Accommodation</option>
                    <option value="Double Sharing Room">Double Sharing Accommodation</option>
                    <option value="Suite / Master Room">Contemporary Suite / Master Room</option>
                    <option value="Daily Tiffin Service">Daily Tiffin Meal Service</option>
                    <option value="On-site Visit Request">Schedule an On-site Visit</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs uppercase font-mono tracking-wider text-[#1A2E20] font-semibold mb-2">
                    Message or Special Requirement
                  </label>
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us about your expected move-in date, company/college, or meal preferences..."
                    className="w-full px-4 py-3.5 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/30 text-[#1A2E20] placeholder-[#5E715C]/60 text-sm focus:border-[#1A2E20] focus:outline-none focus:ring-1 focus:ring-[#1A2E20] transition-colors resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full sm:w-auto px-8 py-4 rounded-full bg-[#1A2E20] hover:bg-[#263B2D] text-white font-semibold text-xs sm:text-sm tracking-wide transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-3 group"
                >
                  <span>Send Enquiry via WhatsApp</span>
                  <div className="w-6 h-6 rounded-full bg-white text-[#1A2E20] flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Send className="w-3.5 h-3.5" />
                  </div>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
