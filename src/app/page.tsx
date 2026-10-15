"use client";

import React, { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/HeroSection";
import { ServicesSection } from "@/components/ServicesSection";
import { FacilitiesShowcase } from "@/components/FacilitiesShowcase";
import { ReviewsSection } from "@/components/ReviewsSection";
import { UnifiedContact } from "@/components/UnifiedContact";
import { Footer } from "@/components/Footer";
import { RoomModal } from "@/components/RoomModal";
import { RoomCategory, roomsData } from "@/data/roomsData";

export default function HomePage() {
  const [selectedRoom, setSelectedRoom] = useState<RoomCategory | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenGeneralEnquiry = () => {
    setSelectedRoom(roomsData[0]);
    setIsModalOpen(true);
  };

  return (
    <main className="min-h-screen flex flex-col bg-[#FAF8F5] overflow-x-clip">
      {/* Top Refined Navigation */}
      <Navbar onOpenEnquiry={handleOpenGeneralEnquiry} />

      {/* 1. Cinematic Hero Section (Theme: Deep Botanical Green) */}
      <HeroSection onOpenEnquiry={handleOpenGeneralEnquiry} />

      {/* 2. Services We Offer (Theme: Warm Cream & Ivory) */}
      <ServicesSection />

      {/* 3. Living Spaces & Facilities Showcase (Theme: Deep Botanical Green / Cinematic) */}
      <FacilitiesShowcase />

      {/* 4. Resident Testimonials (Theme: Warm Cream & Ivory) */}
      <ReviewsSection />

      {/* 5. Unified Contact Section (Theme: Deep Botanical Green) */}
      <UnifiedContact />

      {/* 6. Simplified Footer */}
      <Footer />

      {/* Interactive Room Enquiry Modal */}
      <RoomModal
        room={selectedRoom}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </main>
  );
}
