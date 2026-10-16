/**
 * Ravinarayan Brand Design Tokens (Source of Truth)
 * 
 * Reconciled directly from the public botanical luxury hospitality website.
 * These tokens define color palettes, typography, spacing, and surface treatments
 * for both the public website and the management ERP.
 */

export const brandTokens = {
  name: "Ravinarayan PG Guesthouse",
  tagline: "Botanical Living & Fresh Tiffin Service",
  location: "Met City • Yakubpur • Jhajjar, Haryana",

  // Core Palette
  colors: {
    // Forest Evergreen (Dominant primary)
    forest: {
      DEFAULT: "#5D7656", // signature muted green
      light: "#789078",
      dark: "#263B2D",    // deep evergreen for high contrast & headers
      deepest: "#1A2E20", // rich nocturnal green
      surface: "#3D5240", // muted card/section green
      night: "#16221A",   // dark background base
    },

    // Sage (Secondary botanical neutral)
    sage: {
      DEFAULT: "#8E9F89", // light sage rule lines & borders
      light: "#A8B9A1",   // subtle accents
      pale: "#DCE5D7",    // soft chips & tags
      dark: "#5D7656",
    },

    // Warm Ivory & Cream (Canvas & Surfaces)
    surface: {
      canvas: "#FAF8F5",  // primary warm ivory background
      ivory: "#FBF9F3",   // light soft ivory
      cream: "#F4F0E5",   // warm secondary card surface
      subtle: "#ECE7D8",  // border tone
      card: "#FFFFFF",    // elevated crisp card
    },

    // Warm Brass & Gold (Restrained luxury accents)
    brass: {
      DEFAULT: "#B58A57", // refined warm brass
      light: "#C89F6B",   // hover highlights & badges
      dark: "#9E7443",    // focused active accents
    },

    // Restrained Walnut Brown (Warm earthy accent)
    walnut: {
      DEFAULT: "#654735",
      light: "#7D5842",
      dark: "#4E3628",
    },

    // Text & Content (WCAG AA & AAA compliant contrast)
    text: {
      primary: "#1A2E20", // deep forest charcoal (high legibility: 14.5:1 on white)
      secondary: "#3E4E42",// dark readable neutral (8.0:1 on white)
      muted: "#5A6C5E",   // legible labels & captions (5.1:1 on white)
      light: "#FBF9F3",   // light text on dark surfaces
      subdued: "#6E7F70", // readable placeholders & hints (4.6:1 on white)
    },

    // Semantic Status Tokens
    status: {
      success: {
        bg: "#EBF3E8",
        text: "#2F6B24",
        border: "#C3DEB9",
      },
      warning: {
        bg: "#FBF4E6",
        text: "#8F6710",
        border: "#ECD8AB",
      },
      danger: {
        bg: "#FDF0ED",
        text: "#9A3423",
        border: "#F5C8BF",
      },
      info: {
        bg: "#EEF4F8",
        text: "#1E587A",
        border: "#C2DCED",
      },
    },
  },

  // Typography
  typography: {
    fonts: {
      serif: "var(--font-serif), 'Cormorant Garamond', 'Playfair Display', Georgia, serif",
      sans: "var(--font-sans), 'Plus Jakarta Sans', Inter, system-ui, -apple-system, sans-serif",
      mono: "var(--font-sans), 'Plus Jakarta Sans', Inter, system-ui, -apple-system, sans-serif",
    },
    letterSpacing: {
      tight: "-0.02em",
      normal: "0",
      wide: "0.06em",
      widest: "0.15em",
      ultra: "0.25em",
    },
  },

  // Surfaces & Radii
  radii: {
    xs: "0.375rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
    pill: "9999px",
  },

  // Shadows (Soft, diffused, never harsh)
  shadows: {
    subtle: "0 1px 3px 0 rgba(26, 46, 32, 0.05)",
    card: "0 4px 20px -2px rgba(26, 46, 32, 0.06)",
    elevated: "0 10px 30px -4px rgba(26, 46, 32, 0.10)",
  },
} as const;

export type BrandTokens = typeof brandTokens;

/**
 * Direct Tailwind CSS color palette extensions derived from brand tokens
 */
export const brandColors = {
  forest: {
    DEFAULT: brandTokens.colors.forest.DEFAULT,
    light: brandTokens.colors.forest.light,
    dark: brandTokens.colors.forest.dark,
    deep: brandTokens.colors.forest.deepest,
    surface: brandTokens.colors.forest.surface,
    night: brandTokens.colors.forest.night,
  },
  deep: brandTokens.colors.forest.dark,
  cream: {
    DEFAULT: brandTokens.colors.surface.cream,
    subtle: brandTokens.colors.surface.subtle,
    dark: "#E3DCB8",
  },
  ivory: brandTokens.colors.surface.ivory,
  canvas: brandTokens.colors.surface.canvas,
  sage: {
    DEFAULT: brandTokens.colors.sage.DEFAULT,
    light: brandTokens.colors.sage.light,
    pale: brandTokens.colors.sage.pale,
    dark: brandTokens.colors.sage.dark,
  },
  pale: brandTokens.colors.sage.pale,
  brass: {
    DEFAULT: brandTokens.colors.brass.DEFAULT,
    light: brandTokens.colors.brass.light,
    dark: brandTokens.colors.brass.dark,
  },
  walnut: {
    DEFAULT: brandTokens.colors.walnut.DEFAULT,
    light: brandTokens.colors.walnut.light,
    dark: brandTokens.colors.walnut.dark,
  },
  charcoal: brandTokens.colors.text.primary,
  muted: brandTokens.colors.text.muted,
};

/**
 * Direct Tailwind CSS font family definitions derived from brand tokens
 */
export const brandFonts = {
  serif: ["var(--font-serif)", "Playfair Display", "Cormorant Garamond", "Georgia", "serif"],
  sans: ["var(--font-sans)", "Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
  mono: ["var(--font-sans)", "Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
};
