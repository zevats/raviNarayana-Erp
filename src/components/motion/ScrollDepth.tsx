"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";

interface ScrollDepthProps {
  children: React.ReactNode;
  className?: string;
  depth?: number; // max pixels of vertical parallax (default 18px)
  scaleEffect?: boolean;
}

/**
 * Subtle 2.5D Scroll-Linked Depth Component
 * Moves the inner visual content by a few pixels relative to the container as the user scrolls,
 * creating depth and dimensionality without disorienting layout shifts.
 */
export const ScrollDepth: React.FC<ScrollDepthProps> = ({
  children,
  className = "",
  depth = 18,
  scaleEffect = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile, { passive: true });
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  // Subtle vertical offset: from +depth/2 to -depth/2
  const yParallax = useTransform(
    scrollYProgress,
    [0, 1],
    isMobile || shouldReduceMotion ? [0, 0] : [depth, -depth]
  );

  const scale = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    isMobile || shouldReduceMotion || !scaleEffect ? [1, 1, 1] : [0.98, 1, 1.02]
  );

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <motion.div
        style={{
          y: yParallax,
          scale,
        }}
        className="w-full h-full will-change-transform"
      >
        {children}
      </motion.div>
    </div>
  );
};
