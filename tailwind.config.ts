import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        forest: {
          DEFAULT: "#5D7656", // Cabana's primary muted green rgb(93, 118, 86)
          light: "#789078",   // user suggested muted green #789078
          dark: "#263B2D",    // deep green for readable text & contrast #263B2D
          surface: "#3D5240", // soft muted green for surface sections
        },
        deep: "#263B2D",      // deep botanical green for contrast
        cream: {
          DEFAULT: "#F4F0E5", // warm cream
          subtle: "#ECE7D8",
          dark: "#E3DCB8",
        },
        ivory: "#FBF9F3",     // soft ivory
        sage: {
          DEFAULT: "#8E9F89", // Cabana light sage rgb(142, 159, 137)
          light: "#A8B9A1",   // user suggested light sage #A8B9A1
          pale: "#DCE5D7",    // user suggested pale green #DCE5D7
          dark: "#5D7656",
        },
        pale: "#DCE5D7",      // pale green #DCE5D7
        brass: {
          DEFAULT: "#B58A57",
          light: "#C89F6B",
          dark: "#9E7443",
        },
        charcoal: "#263B2D",  // deep green for readable text #263B2D
        muted: "#5E715C",     // readable muted botanical sage
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Playfair Display", "Cormorant Garamond", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
      },
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

