"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { X, Phone, MessageSquare, Check, AlertCircle, ArrowUpRight } from "lucide-react";
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-black/85 backdrop-blur-md transition-opacity duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="relative w-full max-w-2xl bg-[#16221A] border border-white/10 rounded-3xl shadow-2xl overflow-hidden my-8 text-white">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-black/60 text-white/80 hover:text-white hover:bg-black/90 transition-colors border border-white/15 flex items-center justify-center"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header Media */}
        {room && (
          <div className="relative h-48 sm:h-60 w-full overflow-hidden bg-[#1E2D22]">
            <Image
              src={room.image}
              alt={room.name}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 600px"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#16221A] via-[#16221A]/50 to-transparent" />
            <div className="absolute bottom-4 left-6 right-6">
              <span className="inline-block px-3 py-1 rounded-full bg-white/10 border border-white/15 text-white/90 text-[10px] font-mono uppercase tracking-wider mb-2">
                {room.occupancyType} Category
              </span>
              <h3 id="modal-title" className="font-serif text-2xl sm:text-3xl font-medium text-white">
                {room.name}
              </h3>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 sm:p-8 space-y-6">
          {room && (
            <div>
              <p className="text-sm text-white/80 leading-relaxed mb-3 font-light">
                {room.description}
              </p>
              <div className="flex items-center gap-2.5 text-xs text-[#A8B9A1] bg-white/5 p-3.5 rounded-2xl border border-white/10">
                <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{room.enquiryNote}</span>
              </div>
            </div>
          )}

          {/* Quick Direct Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={handleQuickWhatsApp}
              className="flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white font-medium text-xs tracking-wider uppercase transition-all shadow-md"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Instant WhatsApp Enquiry</span>
            </button>

            <a
              href={`tel:${siteConfig.phoneRaw}`}
              className="flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-full border border-white/20 hover:bg-white/10 text-white font-medium text-xs tracking-wider uppercase transition-all"
            >
              <Phone className="w-4 h-4 text-emerald-400" />
              <span>Call: {siteConfig.phone}</span>
            </a>
          </div>

          <div className="relative flex items-center justify-center">
            <span className="w-full border-t border-white/10" />
            <span className="bg-[#16221A] px-3 text-[10px] uppercase tracking-widest text-white/50 font-mono absolute">
              Or Send Quick Callback Request
            </span>
          </div>

          {/* Enquiry Form */}
          {submitted ? (
            <div className="p-6 rounded-2xl bg-white/5 border border-white/15 text-center space-y-2">
              <Check className="w-8 h-8 text-emerald-400 mx-auto" />
              <p className="font-serif text-lg font-bold text-white">Enquiry Prepared!</p>
              <p className="text-xs text-white/80">Opening direct WhatsApp chat with management...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-[#A8B9A1] mb-1.5 font-mono">
                    Your Name
                  </label>
                  <input
                    type="text"
                    required
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/15 text-white placeholder-white/30 text-sm focus:border-white focus:outline-none focus:ring-1 focus:ring-white transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-[#A8B9A1] mb-1.5 font-mono">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/15 text-white placeholder-white/30 text-sm focus:border-white focus:outline-none focus:ring-1 focus:ring-white transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-[#A8B9A1] mb-1.5 font-mono">
                  Target Move-in Date
                </label>
                <input
                  type="text"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  placeholder="e.g. 1st of next month, Immediate, etc."
                  className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/15 text-white placeholder-white/30 text-sm focus:border-white focus:outline-none focus:ring-1 focus:ring-white transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-[#A8B9A1] mb-1.5 font-mono">
                  Additional Notes or Questions
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Need food service, parking space, or specific study desk requirements..."
                  className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/15 text-white placeholder-white/30 text-sm focus:border-white focus:outline-none focus:ring-1 focus:ring-white transition-colors resize-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-4 rounded-full bg-white hover:bg-white/95 text-[#1A2E20] font-semibold text-xs tracking-wide uppercase transition-all duration-300 shadow-xl flex items-center justify-center gap-2 group"
              >
                <span>Submit Enquiry via WhatsApp</span>
                <div className="w-6 h-6 rounded-full bg-[#1A2E20] text-white flex items-center justify-center group-hover:scale-105 transition-transform">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </div>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
