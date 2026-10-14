"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { X, Phone, MessageSquare, Check, Sparkles, AlertCircle } from "lucide-react";
import { RoomCategory } from "@/data/roomsData";
import { siteConfig } from "@/data/siteConfig";

interface RoomModalProps {
  room: RoomCategory | null;
  isOpen: boolean;
  onClose: () => void;
}

export const RoomModal: React.FC<RoomModalProps> = ({ room, isOpen, onClose }) => {
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const roomTitle = room ? room.name : "Accommodation & Tiffin";

  const handleQuickWhatsApp = () => {
    const text = encodeURIComponent(
      `Hello Ravinarayan Team, I am interested in inquiring about "${roomTitle}" at your Met City / Yakubpur guesthouse. Could you please share current vacancy and schedule a visit?`
    );
    window.open(`https://wa.me/918571801102?text=${text}`, "_blank");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestPhone) return;

    // Direct WhatsApp relay
    const inquiryText = encodeURIComponent(
      `*New Room Enquiry*\nRoom: ${roomTitle}\nName: ${guestName || "Guest"}\nPhone: ${guestPhone}\nTarget Move-in: ${preferredDate || "Immediate"}\nNotes: ${notes || "None"}`
    );
    window.open(`https://wa.me/918571801102?text=${inquiryText}`, "_blank");
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      onClose();
    }, 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-black/80 backdrop-blur-md transition-opacity duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="relative w-full max-w-2xl bg-[#102A22] border border-sage/30 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden my-8 text-ivory">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-forest-dark/80 text-cream hover:text-ivory hover:bg-forest transition-colors border border-sage/20"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header Media */}
        {room && (
          <div className="relative h-48 sm:h-60 w-full overflow-hidden bg-forest-dark">
            <Image
              src={room.image}
              alt={room.name}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 600px"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#102A22] via-[#102A22]/50 to-transparent" />
            <div className="absolute bottom-4 left-6 right-6">
              <span className="inline-block px-3 py-1 rounded-full bg-brass/30 border border-brass/40 text-brass text-[11px] font-mono uppercase tracking-wider mb-2">
                {room.occupancyType} Category
              </span>
              <h3 id="modal-title" className="font-serif text-2xl sm:text-3xl font-bold text-ivory">
                {room.name}
              </h3>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 sm:p-8 space-y-6">
          {room && (
            <div>
              <p className="text-sm text-cream/90 leading-relaxed mb-3">
                {room.description}
              </p>
              <div className="flex items-center gap-2 text-xs text-sage bg-forest-dark/70 p-3 rounded-xl border border-sage/15">
                <AlertCircle className="w-4 h-4 text-brass shrink-0" />
                <span>{room.enquiryNote}</span>
              </div>
            </div>
          )}

          {/* Quick Direct Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={handleQuickWhatsApp}
              className="flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm transition-all shadow-md"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Instant WhatsApp Enquiry</span>
            </button>

            <a
              href={`tel:${siteConfig.phoneRaw}`}
              className="flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-brass/40 hover:bg-brass/10 text-cream font-semibold text-sm transition-all"
            >
              <Phone className="w-4 h-4 text-brass" />
              <span>Call: {siteConfig.phone}</span>
            </a>
          </div>

          <div className="relative flex items-center justify-center">
            <span className="w-full border-t border-sage/20" />
            <span className="bg-[#102A22] px-3 text-xs uppercase tracking-widest text-sage/70 font-mono absolute">
              Or Send Quick Request
            </span>
          </div>

          {/* Enquiry Form */}
          {submitted ? (
            <div className="p-6 rounded-2xl bg-forest-light/60 border border-brass/40 text-center space-y-2">
              <Check className="w-8 h-8 text-brass mx-auto" />
              <p className="font-serif text-lg font-bold text-ivory">Enquiry Prepared!</p>
              <p className="text-xs text-cream/80">Opening direct WhatsApp chat with management...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-sage mb-1.5 font-mono">
                    Your Name
                  </label>
                  <input
                    type="text"
                    required
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="w-full px-4 py-2.5 rounded-xl bg-forest-dark border border-sage/30 text-ivory placeholder-sage/50 text-sm focus:border-brass focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-sage mb-1.5 font-mono">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-4 py-2.5 rounded-xl bg-forest-dark border border-sage/30 text-ivory placeholder-sage/50 text-sm focus:border-brass focus:outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-sage mb-1.5 font-mono">
                  Preferred Move-in / Visit Date
                </label>
                <input
                  type="text"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  placeholder="e.g. Next Monday / Immediate"
                  className="w-full px-4 py-2.5 rounded-xl bg-forest-dark border border-sage/30 text-ivory placeholder-sage/50 text-sm focus:border-brass focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-sage mb-1.5 font-mono">
                  Additional Notes or Questions
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ask about room sharing options, food service, AC availability, etc."
                  className="w-full px-4 py-2.5 rounded-xl bg-forest-dark border border-sage/30 text-ivory placeholder-sage/50 text-sm focus:border-brass focus:outline-none transition-colors resize-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3.5 rounded-xl bg-brass hover:bg-brass-light text-forest-dark font-bold text-sm tracking-wider uppercase transition-all duration-300 shadow-xl flex items-center justify-center gap-2"
              >
                <span>Submit & Inquire on WhatsApp</span>
                <Sparkles className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
