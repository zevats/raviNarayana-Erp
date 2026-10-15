"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { LUXURY_EASE } from "@/utils/motion";

interface MaskedHeadingProps {
  children: React.ReactNode;
  tag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "div";
  className?: string;
  delay?: number;
  stagger?: number;
  ariaLabel?: string;
}

/**
 * Editorial Masked Heading Reveal (Cabana Style)
 * Splits text into words with smooth optical blur and relaxed upward float.
 */
export const MaskedHeading: React.FC<MaskedHeadingProps> = ({
  children,
  tag = "h2",
  className = "",
  delay = 0,
  stagger = 0.14,
  ariaLabel,
}) => {
  const shouldReduceMotion = useReducedMotion();

  // If children is a simple string, split into words
  if (typeof children === "string") {
    const words = children.split(" ");
    const computedAriaLabel = ariaLabel || children;

    if (shouldReduceMotion) {
      const Tag = tag;
      return (
        <Tag className={className} aria-label={computedAriaLabel}>
          {children}
        </Tag>
      );
    }

    const Tag = motion[tag] as any;

    return (
      <Tag
        className={className}
        aria-label={computedAriaLabel}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-60px" }}
        variants={{
          hidden: {},
          visible: {
            transition: {
              staggerChildren: stagger,
              delayChildren: delay,
            },
          },
        }}
      >
        {words.map((word, idx) => (
          <span
            key={`${word}-${idx}`}
            className="inline-block overflow-hidden align-top py-0.5"
          >
            <motion.span
              className="inline-block"
              variants={{
                hidden: { y: "115%", opacity: 0, filter: "blur(8px)" },
                visible: {
                  y: "0%",
                  opacity: 1,
                  filter: "blur(0px)",
                  transition: {
                    duration: 1.35,
                    ease: LUXURY_EASE,
                  },
                },
              }}
            >
              {word}&nbsp;
            </motion.span>
          </span>
        ))}
      </Tag>
    );
  }

  // If children is complex JSX, animate as a single masked block
  const Tag = motion[tag] as any;

  if (shouldReduceMotion) {
    const RawTag = tag;
    return <RawTag className={className}>{children}</RawTag>;
  }

  return (
    <div className="overflow-hidden py-1">
      <Tag
        className={className}
        initial={{ y: "115%", opacity: 0, filter: "blur(8px)" }}
        whileInView={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{
          duration: 1.4,
          delay,
          ease: LUXURY_EASE,
        }}
      >
        {children}
      </Tag>
    </div>
  );
};

interface FadeRevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  distance?: number;
}

/**
 * Reusable Scroll-Triggered Fade & Rise Wrapper with Optical Focus
 */
export const FadeReveal: React.FC<FadeRevealProps> = ({
  children,
  className = "",
  delay = 0,
  duration = 1.2,
  direction = "up",
  distance = 28,
}) => {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  const initialPosition = {
    up: { y: distance, x: 0 },
    down: { y: -distance, x: 0 },
    left: { x: distance, y: 0 },
    right: { x: -distance, y: 0 },
    none: { x: 0, y: 0 },
  }[direction];

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, filter: "blur(6px)", ...initialPosition }}
      whileInView={{ opacity: 1, filter: "blur(0px)", x: 0, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{
        duration,
        delay,
        ease: LUXURY_EASE,
      }}
    >
      {children}
    </motion.div>
  );
};
