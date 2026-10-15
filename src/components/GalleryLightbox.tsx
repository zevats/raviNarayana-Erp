"use client";

import React, { useEffect, useCallback } from "react";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export interface GalleryImage {
  src: string;
  title: string;
  category: string;
  description?: string;
}

interface GalleryLightboxProps {
  images: GalleryImage[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export const GalleryLightbox: React.FC<GalleryLightboxProps> = ({
  images,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
}) => {
  const currentImage = images[currentIndex];

  const handleNext = useCallback(() => {
    onNavigate((currentIndex + 1) % images.length);
  }, [currentIndex, images.length, onNavigate]);

  const handlePrev = useCallback(() => {
    onNavigate((currentIndex - 1 + images.length) % images.length);
  }, [currentIndex, images.length, onNavigate]);

  // Handle keyboard navigation: Escape, ArrowLeft, ArrowRight
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose, handleNext, handlePrev]);

  if (!isOpen || !currentImage) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image preview: ${currentImage.title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl animate-fade-in"
      onClick={onClose}
    >
      {/* Top Bar with Counter and Close Button */}
      <div
        className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-4 sm:p-6 bg-gradient-to-b from-black/80 to-transparent"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono tracking-widest text-sage px-3 py-1 rounded-full bg-white/10 border border-white/15">
            {currentIndex + 1} / {images.length}
          </span>
          <span className="text-xs uppercase font-mono text-brass tracking-wider hidden sm:inline-block">
            {currentImage.category}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-cream hover:text-ivory transition-colors border border-white/15"
          aria-label="Close lightbox modal (Escape)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Image Container */}
      <div
        className="relative w-full max-w-5xl h-[70vh] sm:h-[80vh] mx-4 sm:mx-8 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={currentImage.src}
          alt={currentImage.title}
          fill
          sizes="(max-width: 1280px) 95vw, 1200px"
          className="object-contain transition-opacity duration-300"
          priority
        />
      </div>

      {/* Bottom Caption */}
      <div
        className="absolute bottom-0 left-0 right-0 z-50 p-6 bg-gradient-to-t from-black/90 to-transparent text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-serif text-lg sm:text-2xl font-bold text-ivory mb-1">
          {currentImage.title}
        </h3>
        {currentImage.description && (
          <p className="text-xs sm:text-sm text-cream/70 max-w-xl mx-auto font-light">
            {currentImage.description}
          </p>
        )}
      </div>

      {/* Navigation Arrows */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlePrev();
        }}
        className="absolute left-4 sm:left-6 top-1/2 -translate-y-1/2 z-50 p-3 rounded-full bg-black/60 hover:bg-brass hover:text-forest-dark text-ivory transition-all border border-white/20 shadow-xl"
        aria-label="Previous image (Left Arrow)"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleNext();
        }}
        className="absolute right-4 sm:right-6 top-1/2 -translate-y-1/2 z-50 p-3 rounded-full bg-black/60 hover:bg-brass hover:text-forest-dark text-ivory transition-all border border-white/20 shadow-xl"
        aria-label="Next image (Right Arrow)"
      >
        <ChevronRight className="w-6 h-6" />
      </button>
    </div>
  );
};
