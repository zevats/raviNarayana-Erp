import type { Config } from "tailwindcss";
import { brandColors, brandFonts } from "@ravinarayan/brand";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: brandColors,
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "-apple-system", "sans-serif"],
        serif: ["var(--font-serif)", "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-sans)", "Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      letterSpacing: {
        tight: "-0.02em",
        normal: "0",
        wide: "0.025em",
        wider: "0.05em",
        widest: "0.1em",
        ultra: ".25em",
      },
    },
  },
  plugins: [],
};

export default config;
