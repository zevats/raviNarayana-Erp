"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";

interface Card3DProps {
  children: React.ReactNode;
  className?: string;
  maxTilt?: number; // max tilt degrees (default 10)
  glareOpacity?: number; // max glare opacity (default 0.2)
  depth?: number; // translateZ for depth
  onClick?: () => void;
}

export const Card3D: React.FC<Card3DProps> = ({
  children,
  className = "",
  maxTilt = 10,
  glareOpacity = 0.18,
  depth = 20,
  onClick,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number | null>(null);

  // Current interpolated values
  const currentRotX = useRef(0);
  const currentRotY = useRef(0);
  const targetRotX = useRef(0);
  const targetRotY = useRef(0);

  const [glarePos, setGlarePos] = useState({ x: 50, y: 50, active: false });
  const [canHover, setCanHover] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    // Check if device supports true hover and does not prefer reduced motion
    const hoverQuery = window.matchMedia("(hover: hover)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    setCanHover(hoverQuery.matches);
    setReducedMotion(motionQuery.matches);

    const handleHoverChange = (e: MediaQueryListEvent) => setCanHover(e.matches);
    const handleMotionChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);

    hoverQuery.addEventListener("change", handleHoverChange);
    motionQuery.addEventListener("change", handleMotionChange);

    return () => {
      hoverQuery.removeEventListener("change", handleHoverChange);
      motionQuery.removeEventListener("change", handleMotionChange);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  // Smooth lerp animation loop
  const updateTransform = useCallback(() => {
    // Lerp factor
    const ease = 0.12;
    currentRotX.current += (targetRotX.current - currentRotX.current) * ease;
    currentRotY.current += (targetRotY.current - currentRotY.current) * ease;

    if (cardRef.current) {
      cardRef.current.style.transform = `perspective(1200px) rotateX(${currentRotX.current.toFixed(
        2
      )}deg) rotateY(${currentRotY.current.toFixed(2)}deg) translateZ(${
        targetRotX.current !== 0 || targetRotY.current !== 0 ? depth : 0
      }px)`;
    }

    // Continue loop if not settled
    const diff =
      Math.abs(targetRotX.current - currentRotX.current) +
      Math.abs(targetRotY.current - currentRotY.current);

    if (diff > 0.02) {
      rafId.current = requestAnimationFrame(updateTransform);
    } else {
      rafId.current = null;
    }
  }, [depth]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canHover || reducedMotion || !cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5; // -0.5 to 0.5

    // Invert Y for standard natural 3D tilt
    targetRotX.current = -y * maxTilt * 2;
    targetRotY.current = x * maxTilt * 2;

    setGlarePos({
      x: (x + 0.5) * 100,
      y: (y + 0.5) * 100,
      active: true,
    });

    if (!rafId.current) {
      rafId.current = requestAnimationFrame(updateTransform);
    }
  };

  const handlePointerLeave = () => {
    if (!canHover || reducedMotion) return;

    targetRotX.current = 0;
    targetRotY.current = 0;
    setGlarePos((prev) => ({ ...prev, active: false }));

    if (!rafId.current) {
      rafId.current = requestAnimationFrame(updateTransform);
    }
  };

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={onClick}
      className={`relative will-change-transform transition-shadow duration-300 ${className}`}
      style={{
        transformStyle: "preserve-3d",
      }}
    >
      {/* Card Content */}
      <div className="w-full h-full relative" style={{ transformStyle: "preserve-3d" }}>
        {children}
      </div>

      {/* Dynamic Specular Lighting Glare */}
      {canHover && !reducedMotion && (
        <div
          className="pointer-events-none absolute inset-0 z-30 rounded-inherit transition-opacity duration-300 overflow-hidden rounded-[inherit]"
          style={{
            opacity: glarePos.active ? 1 : 0,
            background: `radial-gradient(circle 350px at ${glarePos.x}% ${glarePos.y}%, rgba(255, 255, 255, ${glareOpacity}) 0%, rgba(255,255,255,0) 70%)`,
            mixBlendMode: "overlay",
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
};
