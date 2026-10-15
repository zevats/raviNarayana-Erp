/**
 * Shared Motion Design System for Ravinarayan PG Guesthouse
 * 
 * Cinematic, restrained, accessible animation system inspired by
 * Cabana Mountain and high-end Framer digital hospitality templates.
 */

import { Variants, Transition } from "framer-motion";

// Signature luxury Framer/Apple deceleration cubic Bézier curve
// Long, silky deceleration that floats smoothly into rest (Cabana Mountain inspired)
export const LUXURY_EASE = [0.16, 1, 0.3, 1] as const;
export const SMOOTH_EASE = [0.22, 1, 0.36, 1] as const;

// Transition presets (Calm, relaxed, unhurried pacing)
export const transitions = {
  instant: { duration: 0.25, ease: "easeOut" } as Transition,
  micro: { duration: 0.45, ease: LUXURY_EASE } as Transition,
  standard: { duration: 1.15, ease: LUXURY_EASE } as Transition,
  editorial: { duration: 1.35, ease: LUXURY_EASE } as Transition,
  slowReveal: { duration: 1.6, ease: LUXURY_EASE } as Transition,
};

// Fade In & Rise (Standard Content Reveal with subtle optical focus)
export const fadeInUp: Variants = {
  hidden: {
    opacity: 0,
    y: 32,
    filter: "blur(6px)",
  },
  visible: (customDelay: number = 0) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration: 1.2,
      delay: customDelay,
      ease: LUXURY_EASE,
    },
  }),
};

// Subtle Horizontal Reveals
export const fadeInLeft: Variants = {
  hidden: {
    opacity: 0,
    x: -36,
    filter: "blur(4px)",
  },
  visible: (customDelay: number = 0) => ({
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: {
      duration: 1.25,
      delay: customDelay,
      ease: LUXURY_EASE,
    },
  }),
};

export const fadeInRight: Variants = {
  hidden: {
    opacity: 0,
    x: 36,
    filter: "blur(4px)",
  },
  visible: (customDelay: number = 0) => ({
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: {
      duration: 1.25,
      delay: customDelay,
      ease: LUXURY_EASE,
    },
  }),
};

// Masked Image Reveal (Scale + Clip)
export const imageReveal: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
  },
  visible: (customDelay: number = 0) => ({
    opacity: 1,
    scale: 1,
    transition: {
      duration: 1.35,
      delay: customDelay,
      ease: LUXURY_EASE,
    },
  }),
};

// Staggered Container for Lists and Groups (Relaxed 160ms cadence)
export const staggerContainer = (
  staggerChildren: number = 0.16,
  delayChildren: number = 0.08
): Variants => ({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren,
      delayChildren,
    },
  },
});

// Stagger Item (Child of staggerContainer)
export const staggerItem: Variants = {
  hidden: {
    opacity: 0,
    y: 24,
    filter: "blur(4px)",
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration: 1.1,
      ease: LUXURY_EASE,
    },
  },
};

// Hairline Rule Expansion
export const ruleExpand: Variants = {
  hidden: {
    scaleX: 0,
    opacity: 0,
  },
  visible: (customDelay: number = 0) => ({
    scaleX: 1,
    opacity: 1,
    transition: {
      duration: 1.2,
      delay: customDelay,
      ease: LUXURY_EASE,
    },
  }),
};

// Viewport trigger settings for scroll-driven reveals (triggers once, well before edge)
export const viewportConfig = {
  once: true,
  margin: "-60px",
  amount: 0.15,
};
