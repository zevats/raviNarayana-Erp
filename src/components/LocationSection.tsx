"use client";

import React, { useState } from "react";
import { MapPin, Phone, MessageSquare, Clock, Navigation, Check, Mail, Send } from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export const LocationSection: React.FC = () => {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("Room Booking");
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
    <section id="location" className="relative py-24 sm:py-32 bg-ivory text-charcoal overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="max-w-3xl mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 text-forest text-xs font-semibold tracking-widest uppercase mb-3">
            <span className="w-8 h-px bg-brass" />
            <span>05 &bull; Strategic Location &amp; Contact</span>
          </div>
          <h2 className="headline-display font-serif font-bold text-forest tracking-tight">
            Serving Met City, Yakubpur &amp; Jhajjar
          </h2>
          <p className="mt-3 text-muted text-base sm:text-lg leading-relaxed">
            Positioned conveniently for executives, project managers, and students seeking quiet residential comfort near major workplaces.
          </p>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
          {/* Left Column: Direct Contact & Location Highlights */}
          <div className="lg:col-span-5 space-y-6">
            {/* Phone Card */}
            <div className="p-6 rounded-2xl sm:rounded-3xl bg-cream border border-sage/20 shadow-sm flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-forest text-ivory shrink-0">
                <Phone className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs uppercase font-mono tracking-wider text-brass font-semibold">Direct Phone Call</p>
                <a
                  href={`tel:${siteConfig.phoneRaw}`}
                  className="font-serif text-2xl font-bold text-forest hover:text-brass transition-colors block mt-1"
                >
                  {siteConfig.phone}
                </a>
                <p className="text-xs text-muted mt-1">Available daily for room bookings &amp; meal inquiries</p>
              </div>
            </div>

            {/* WhatsApp Card */}
            <div className="p-6 rounded-2xl sm:rounded-3xl bg-cream border border-sage/20 shadow-sm flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-emerald-700 text-white shrink-0">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs uppercase font-mono tracking-wider text-emerald-800 font-semibold">Official WhatsApp</p>
                <a
                  href={siteConfig.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-serif text-xl font-bold text-forest hover:text-emerald-700 transition-colors block mt-1"
                >
                  Chat with Management
                </a>
                <p className="text-xs text-muted mt-1">Instant responses for vacancy &amp; on-site visits</p>
              </div>
            </div>

            {/* Area Overview */}
            <div className="p-6 rounded-2xl sm:rounded-3xl bg-white border border-sage/20 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-brass" />
                <h3 className="font-serif font-bold text-forest text-lg">Location Area</h3>
              </div>
              <p className="text-sm text-muted leading-relaxed">
                Ravinarayan PG Guesthouse is situated in the <strong className="text-charcoal">Met City / Yakubpur</strong> cluster, serving residents across <strong className="text-charcoal">Jhajjar, Haryana</strong>.
              </p>
              <div className="pt-2 border-t border-charcoal/10 flex items-center justify-between">
                <span className="text-xs text-sage font-mono">State of Haryana &bull; India</span>
                <a
                  href="https://maps.google.com/?q=Met+City+Yakubpur+Jhajjar+Haryana"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-forest hover:text-brass transition-colors"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Open in Google Maps</span>
                </a>
              </div>
            </div>
          </div>

          {/* Right Column: Direct Message Form */}
          <div className="lg:col-span-7 bg-white rounded-2xl sm:rounded-3xl p-8 sm:p-10 border border-sage/20 shadow-xl">
            <h3 className="font-serif text-2xl font-bold text-forest mb-2">
              Send an Enquiry
            </h3>
            <p className="text-sm text-muted mb-8">
              Fill in your details below. We will connect with you directly via phone or WhatsApp.
            </p>

            {sent ? (
              <div className="p-8 rounded-2xl bg-forest/5 border border-forest/20 text-center space-y-3">
                <Check className="w-10 h-10 text-forest mx-auto" />
                <h4 className="font-serif text-xl font-bold text-forest">Enquiry Ready!</h4>
                <p className="text-sm text-muted">
                  Opening WhatsApp to finalize your inquiry with the Ravinarayan team...
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs uppercase font-mono tracking-wider text-forest font-semibold mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Amit Kumar"
                      className="w-full px-4 py-3 rounded-xl bg-ivory border border-sage/30 text-charcoal placeholder-muted/60 text-sm focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase font-mono tracking-wider text-forest font-semibold mb-2">
                      Phone Number *
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full px-4 py-3 rounded-xl bg-ivory border border-sage/30 text-charcoal placeholder-muted/60 text-sm focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase font-mono tracking-wider text-forest font-semibold mb-2">
                    Enquiry Category
                  </label>
                  <select
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-ivory border border-sage/30 text-charcoal text-sm focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest transition-colors"
                  >
                    <option value="Single Room PG">Single Room Accommodation</option>
                    <option value="Double Sharing Room">Double Sharing Accommodation</option>
                    <option value="Suite / Master Room">Contemporary Suite / Master Room</option>
                    <option value="Daily Tiffin Service">Daily Tiffin Meal Service</option>
                    <option value="On-site Visit Request">Schedule an On-site Visit</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs uppercase font-mono tracking-wider text-forest font-semibold mb-2">
                    Message or Special Requirement
                  </label>
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us about your expected move-in date, company/college, or meal preferences..."
                    className="w-full px-4 py-3 rounded-xl bg-ivory border border-sage/30 text-charcoal placeholder-muted/60 text-sm focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest transition-colors resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-forest hover:bg-forest-light text-ivory font-bold text-xs tracking-wider uppercase transition-all duration-300 shadow-lg flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4 text-brass" />
                  <span>Send Enquiry via WhatsApp</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
