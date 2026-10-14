"use client";

import React, { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/HeroSection";
import { StorySection } from "@/components/StorySection";
import { RoomsGallery } from "@/components/RoomsGallery";
import { AmenitiesSection } from "@/components/AmenitiesSection";
import { TiffinHighlight } from "@/components/TiffinHighlight";
import { LocationSection } from "@/components/LocationSection";
import { FinalCTA } from "@/components/FinalCTA";
import { Footer } from "@/components/Footer";
import { RoomModal } from "@/components/RoomModal";
import { RoomCategory, roomsData } from "@/data/roomsData";

export default function HomePage() {
  const [selectedRoom, setSelectedRoom] = useState<RoomCategory | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSelectRoom = (room: RoomCategory) => {
    setSelectedRoom(room);
    setIsModalOpen(true);
  };

  const handleOpenGeneralEnquiry = () => {
    setSelectedRoom(roomsData[0]);
    setIsModalOpen(true);
  };

  return (
    <main className="min-h-screen flex flex-col bg-ivory">
      {/* Top Refined Navigation */}
      <Navbar onOpenEnquiry={handleOpenGeneralEnquiry} />

      {/* Cinematic Hero */}
      <HeroSection onOpenEnquiry={handleOpenGeneralEnquiry} />

      {/* Editorial Story / Brand Philosophy */}
      <StorySection />

      {/* Premium Accommodations Showcase */}
      <RoomsGallery onSelectRoom={handleSelectRoom} />

      {/* Curated Amenities */}
      <AmenitiesSection />

      {/* Home-Style Tiffin Service */}
      <TiffinHighlight />

      {/* Location & Enquiry Form */}
      <LocationSection />

      {/* Final Editorial Call to Action */}
      <FinalCTA onOpenEnquiry={handleOpenGeneralEnquiry} />

      {/* Shared Footer */}
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
