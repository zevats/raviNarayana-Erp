"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import {
  Phone,
  MessageSquare,
  MapPin,
  Clock,
  Send,
  CheckCircle,
  HelpCircle,
  Instagram,
  ExternalLink,
} from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [service, setService] = useState("Single Room Accommodation");
  const [message, setMessage] = useState("");
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;

    const query = encodeURIComponent(
      `*Website Contact Submission*\nName: ${name || "Guest"}\nPhone: ${phone}\nService Interested: ${service}\nMessage: ${message || "Please provide vacancy and details."}`
    );
    window.open(`https://wa.me/918571801102?text=${query}`, "_blank");
    setIsSent(true);
    setTimeout(() => setIsSent(false), 3000);
  };

  const faqs = [
    {
      q: "Where exactly is Ravinarayan PG Guesthouse located?",
      a: "We serve the Met City, Yakubpur, and Jhajjar region in Haryana, conveniently positioned close to major industrial units and transport corridors.",
    },
    {
      q: "How can I schedule a personal on-site visit?",
      a: "Simply call +91-8571801102 or message us on WhatsApp to confirm what time you would like to visit. Our staff will be happy to guide you.",
    },
    {
      q: "Can I subscribe only to the Tiffin Service without staying at the PG?",
      a: "Yes! Our homemade tiffin service delivers breakfast, lunch, and dinner across Met City, Yakubpur, and Jhajjar regardless of whether you live at our guesthouse.",
    },
    {
      q: "What amenities are included with the room?",
      a: "All room packages include high-speed Wi-Fi, 24/7 RO purified water, CCTV campus surveillance, and access to laundry facilities.",
    },
  ];

  return (
    <main className="min-h-screen flex flex-col bg-[#FAF8F5]">
      <Navbar />

      {/* Hero Header */}
      <section className="relative pt-36 pb-20 sm:pb-24 bg-[#16221A] text-white overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/hero-bg.jpg"
            alt="Ravinarayan Ambience"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#16221A] via-[#16221A]/80 to-black/70" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-5 shadow-sm">
              <span>WE ARE HERE FOR YOU</span>
            </div>
            <h1 className="font-serif text-white tracking-tight font-normal text-4xl sm:text-6xl md:text-7xl leading-[1.08] mb-4">
              Connect With <br className="hidden sm:inline" />
              <span className="italic font-light text-white/95">Ravinarayan</span>
            </h1>
            <p className="text-base sm:text-lg text-white/85 font-light leading-relaxed">
              Have questions regarding room vacancy, long-term corporate stays, or daily tiffin delivery? Call us directly or send a message below.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Cards & Form */}
      <section className="py-20 sm:py-24 bg-[#FAF8F5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            {/* Left Column: Direct Methods */}
            <div className="lg:col-span-5 space-y-6">
              {/* Phone */}
              <div className="p-7 rounded-3xl bg-white border border-[#8E9F89]/20 shadow-md">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-3 rounded-2xl bg-[#1A2E20] text-white">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[#5E715C] font-semibold">
                      Telephone
                    </span>
                    <h3 className="font-serif font-medium text-[#1A2E20] text-lg">Direct Phone Help Desk</h3>
                  </div>
                </div>
                <a
                  href={`tel:${siteConfig.phoneRaw}`}
                  className="font-serif text-2xl font-bold text-[#1A2E20] hover:text-[#5D7656] transition-colors block mt-2"
                >
                  {siteConfig.phone}
                </a>
                <p className="text-xs text-[#5E715C] mt-2 font-light">
                  Direct phone access available 7 days a week for immediate accommodation inquiries.
                </p>
              </div>

              {/* WhatsApp */}
              <div className="p-7 rounded-3xl bg-white border border-[#8E9F89]/20 shadow-md">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-3 rounded-2xl bg-emerald-700 text-white">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-800 font-semibold">
                      Instant Chat
                    </span>
                    <h3 className="font-serif font-medium text-[#1A2E20] text-lg">Official WhatsApp Channel</h3>
                  </div>
                </div>
                <a
                  href={siteConfig.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-serif text-xl font-bold text-emerald-800 hover:text-emerald-700 transition-colors block mt-2"
                >
                  Chat with Ravinarayan Team &rarr;
                </a>
                <p className="text-xs text-[#5E715C] mt-2 font-light">
                  Receive room pictures, location map coordinates, and instant tariff confirmations.
                </p>
              </div>

              {/* Address */}
              <div className="p-7 rounded-3xl bg-white border border-[#8E9F89]/20 shadow-md space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-[#5D7656]/10 text-[#263B2D]">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <h3 className="font-serif font-medium text-[#1A2E20] text-lg">Property Location</h3>
                </div>
                <p className="text-sm text-[#4A584E] leading-relaxed font-light">
                  Met City &bull; Yakubpur, Jhajjar, Haryana 124103, India.
                </p>
                <div className="pt-2 border-t border-[#8E9F89]/20 flex items-center justify-between">
                  <span className="text-xs text-[#5E715C] font-mono">Industrial Zone &bull; Haryana</span>
                  <a
                    href="https://maps.google.com/?q=Met+City+Yakubpur+Jhajjar+Haryana"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1A2E20] hover:text-[#5D7656] transition-colors"
                  >
                    <span>View Map</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Right Column: Interactive Form */}
            <div className="lg:col-span-7 bg-white rounded-3xl p-8 sm:p-10 border border-[#8E9F89]/20 shadow-xl">
              <h2 className="font-serif text-2xl sm:text-3xl font-medium text-[#1A2E20] mb-2">
                Send a Message
              </h2>
              <p className="text-sm text-[#4A584E] mb-8 font-light">
                Submit your inquiry and we will reach out to you directly on WhatsApp or by phone.
              </p>

              {isSent ? (
                <div className="p-8 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-3">
                  <CheckCircle className="w-10 h-10 text-emerald-600 mx-auto" />
                  <h4 className="font-serif text-xl font-bold text-[#1A2E20]">Inquiry Prepared!</h4>
                  <p className="text-sm text-[#4A584E]">
                    Opening WhatsApp to connect directly with the Ravinarayan management team...
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-xs uppercase font-mono tracking-wider text-[#1A2E20] font-semibold mb-2">
                        Your Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Vikas Sharma"
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
                      Inquiry Subject
                    </label>
                    <select
                      value={service}
                      onChange={(e) => setService(e.target.value)}
                      className="w-full px-4 py-3.5 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/30 text-[#1A2E20] text-sm focus:border-[#1A2E20] focus:outline-none focus:ring-1 focus:ring-[#1A2E20] transition-colors"
                    >
                      <option value="Single Room Accommodation">Single Private Room PG</option>
                      <option value="Double Sharing Room">Double Sharing Room PG</option>
                      <option value="Contemporary Suite / Master Room">Contemporary Suite / Master Room</option>
                      <option value="Daily Tiffin Meal Subscription">Daily Tiffin Meal Subscription</option>
                      <option value="Corporate / Group Booking">Corporate / Group Accommodation</option>
                      <option value="General Query or On-site Visit">Schedule an On-site Visit</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-mono tracking-wider text-[#1A2E20] font-semibold mb-2">
                      Message &bull; Move-in Date &bull; Requirements
                    </label>
                    <textarea
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Share details about your expected duration of stay, food requirements, or workplace in Met City..."
                      className="w-full px-4 py-3.5 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/30 text-[#1A2E20] placeholder-[#5E715C]/60 text-sm focus:border-[#1A2E20] focus:outline-none focus:ring-1 focus:ring-[#1A2E20] transition-colors resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full sm:w-auto px-8 py-4 rounded-full bg-[#1A2E20] hover:bg-[#263B2D] text-white font-semibold text-xs sm:text-sm tracking-wide transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-3 group"
                  >
                    <span>Send Inquiry on WhatsApp</span>
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

      {/* Frequently Asked Questions (Theme: Deep Botanical Green) */}
      <section className="py-20 sm:py-24 bg-[#16221A] text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#5D7656]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-4 shadow-xs">
              <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>FREQUENT QUESTIONS</span>
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-normal text-white tracking-tight">
              Common Resident Queries
            </h2>
            <p className="mt-3 text-sm sm:text-base text-white/75 font-light leading-relaxed">
              Transparent answers regarding room admissions, safety policies, and tiffin meal delivery.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {faqs.map((faq, idx) => (
              <div
                key={idx}
                className="p-7 rounded-3xl bg-white/5 border border-white/10 space-y-2 hover:border-white/20 transition-all backdrop-blur-xs"
              >
                <h4 className="font-serif font-medium text-lg text-white">{faq.q}</h4>
                <p className="text-xs sm:text-sm text-white/75 leading-relaxed font-light">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
