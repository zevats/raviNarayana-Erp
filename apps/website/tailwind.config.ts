import type { Config } from "tailwindcss";
import { brandColors, brandFonts } from "@ravinarayan/brand";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: brandColors,
      fontFamily: brandFonts,
      letterSpacing: {
        widest: ".15em",
        ultra: ".25em",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "botanical-glow": "radial-gradient(circle at 50% 30%, rgba(168, 183, 154, 0.15) 0%, transparent 70%)",
        "forest-vignette": "radial-gradient(ellipse at center, rgba(25, 61, 48, 0.4) 0%, rgba(16, 42, 34, 0.95) 100%)",
      },
      animation: {
        "fade-in": "fadeIn 0.8s ease-out forwards",
        "slide-up": "slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "float-gentle": "floatGentle 6s ease-in-out infinite",
        "pulse-subtle": "pulseSubtle 4s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        floatGentle: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

