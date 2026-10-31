import type { Config } from "tailwindcss";
import { brandColors, brandFonts, brandTokens } from "@ravinarayan/brand";

// The brand palette plus the remaining brand tokens by their token names (forest.deepest,
// surface.*, text.*, status.*): the same @ravinarayan/brand values, no new colours.
const colors = {
  ...brandColors,
  forest: { ...brandColors.forest, deepest: brandTokens.colors.forest.deepest },
  surface: brandTokens.colors.surface,
  text: brandTokens.colors.text,
  status: brandTokens.colors.status,
};

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors,
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
