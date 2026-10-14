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
  Sparkles,
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
    <main className="min-h-screen flex flex-col bg-ivory">
      <Navbar />

      {/* Hero Header */}
      <section className="relative pt-36 pb-20 bg-deep text-ivory overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/hero-bg.jpg"
            alt="Ravinarayan Ambience"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-deep via-deep/80 to-black/70" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-forest-light border border-brass/30 text-brass text-xs font-mono uppercase tracking-wider mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              <span>We Are Here For You</span>
            </div>
            <h1 className="headline-hero font-serif font-bold text-ivory tracking-tight mb-4">
              Connect with Ravinarayan
            </h1>
            <p className="text-base sm:text-lg text-cream/90 font-light leading-relaxed">
              Have questions regarding room vacancy, long-term corporate stays, or daily tiffin delivery? Call us directly or send a message below.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Cards & Form */}
      <section className="py-20 sm:py-28 bg-ivory">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            {/* Left Column: Direct Methods */}
            <div className="lg:col-span-5 space-y-6">
              {/* Phone */}
              <div className="p-7 rounded-3xl bg-white border border-sage/20 shadow-md">
                <div className="flex items-center gap-4 mb-3">
                  <div className="p-3 rounded-2xl bg-forest text-ivory">
                    <Phone className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs uppercase font-mono tracking-wider text-brass font-bold">Call Us Directly</p>
                    <a
                      href={`tel:${siteConfig.phoneRaw}`}
                      className="font-serif text-2xl font-bold text-forest hover:text-brass transition-colors"
                    >
                      {siteConfig.phone}
                    </a>
                  </div>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Fastest response for urgent bookings and room inspections.
                </p>
              </div>

              {/* WhatsApp */}
              <div className="p-7 rounded-3xl bg-white border border-sage/20 shadow-md">
                <div className="flex items-center gap-4 mb-3">
                  <div className="p-3 rounded-2xl bg-emerald-700 text-white">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs uppercase font-mono tracking-wider text-emerald-800 font-bold">Official WhatsApp</p>
                    <a
                      href={siteConfig.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-serif text-xl font-bold text-forest hover:text-emerald-700 transition-colors"
                    >
                      Start WhatsApp Chat
                    </a>
                  </div>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Send photos, request location pin, or enquire about meal subscription plans.
                </p>
              </div>

              {/* Location & Social */}
              <div className="p-7 rounded-3xl bg-white border border-sage/20 shadow-md space-y-4">
                <div className="flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-brass" />
                  <h3 className="font-serif font-bold text-forest text-lg">Location Area</h3>
                </div>
                <p className="text-sm text-muted leading-relaxed">
                  Met City &bull; Yakubpur &bull; Jhajjar, Haryana, India
                </p>
                <div className="pt-3 border-t border-charcoal/10 flex items-center justify-between">
                  <a
                    href={siteConfig.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-forest hover:text-brass font-bold transition-colors"
                  >
                    <Instagram className="w-4 h-4" />
                    <span>Follow on Instagram</span>
                  </a>

                  <a
                    href="https://maps.google.com/?q=Met+City+Yakubpur+Jhajjar+Haryana"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-forest hover:text-brass font-bold transition-colors"
                  >
                    <span>View Area Map</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Right Column: Inquiry Form */}
            <div className="lg:col-span-7 bg-white rounded-3xl p-8 sm:p-12 border border-sage/20 shadow-xl">
              <h2 className="headline-display font-serif font-bold text-forest mb-2">
                Send an Enquiry
              </h2>
              <p className="text-sm text-muted mb-8">
                Please leave your requirements. Management will get in touch promptly.
              </p>

              {isSent ? (
                <div className="p-8 rounded-2xl bg-forest/5 border border-forest/20 text-center space-y-3">
                  <CheckCircle className="w-10 h-10 text-forest mx-auto" />
                  <h3 className="font-serif text-xl font-bold text-forest">Enquiry Generated!</h3>
                  <p className="text-sm text-muted">
                    Redirecting to WhatsApp to send your inquiry directly to Ravinarayan management...
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs uppercase font-mono tracking-wider text-forest font-bold mb-2">
                        Your Name
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Vikas Yadav"
                        className="w-full px-4 py-3 rounded-xl bg-ivory border border-sage/30 text-charcoal text-sm focus:border-forest focus:outline-none transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-xs uppercase font-mono tracking-wider text-forest font-bold mb-2">
                        Phone Number *
                      </label>
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+91 98765 43210"
                        className="w-full px-4 py-3 rounded-xl bg-ivory border border-sage/30 text-charcoal text-sm focus:border-forest focus:outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-mono tracking-wider text-forest font-bold mb-2">
                      Service Requirement
                    </label>
                    <select
                      value={service}
                      onChange={(e) => setService(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-ivory border border-sage/30 text-charcoal text-sm focus:border-forest focus:outline-none transition-colors"
                    >
                      <option value="Single Room Accommodation">Single Room Accommodation</option>
                      <option value="Double Sharing Room">Double Sharing Room</option>
                      <option value="Suite / Master Bedroom">Suite / Master Bedroom</option>
                      <option value="Shared Budget Living">Shared Budget Living</option>
                      <option value="Daily Tiffin Service">Daily Tiffin Meal Delivery</option>
                      <option value="Corporate / Group Stay">Corporate / Group Booking</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-mono tracking-wider text-forest font-bold mb-2">
                      Your Message or Inquiry
                    </label>
                    <textarea
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Specify your move-in date, company/college, or special preferences..."
                      className="w-full px-4 py-3 rounded-xl bg-ivory border border-sage/30 text-charcoal text-sm focus:border-forest focus:outline-none transition-colors resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full sm:w-auto px-8 py-4 rounded-full bg-forest hover:bg-forest-light text-ivory font-bold text-xs tracking-wider uppercase transition-all duration-300 shadow-xl flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4 text-brass" />
                    <span>Send via WhatsApp</span>
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* FAQ Accordion */}
          <div className="mt-24 max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="headline-display font-serif font-bold text-forest">
                Frequently Asked Questions
              </h2>
              <p className="text-sm text-muted mt-2">
                Quick clarity regarding our living policies and meal delivery.
              </p>
            </div>

            <div className="space-y-4">
              {faqs.map((faq, i) => (
                <div
                  key={i}
                  className="p-6 rounded-2xl bg-white border border-sage/20 shadow-sm space-y-2"
                >
                  <div className="flex items-start gap-3">
                    <HelpCircle className="w-5 h-5 text-brass shrink-0 mt-0.5" />
                    <h3 className="font-serif font-bold text-forest text-base sm:text-lg">
                      {faq.q}
                    </h3>
                  </div>
                  <p className="text-sm text-muted leading-relaxed pl-8">
                    {faq.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
