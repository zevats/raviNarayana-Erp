# Ravinarayan PG Guesthouse — Immersive Botanical Hospitality Website

An award-grade, cinematic hospitality website recreating and elevating the public online presence for **Ravinarayan PG Guesthouse & Tiffin Service**, located in Met City, Yakubpur, and Jhajjar, Haryana.

## 🌿 Creative Direction: Botanical Luxury Retreat

The project combines visual and interaction ideas inspired by leading boutique hospitality websites (**Oasila**, **Cabana Mountain**, and **Resorto**), translating them into an authentic, dignified, and comfortable living atmosphere tailored for working professionals and students in Haryana:

- **Organic Nature Palette & Warmth (Oasila)**: Deep forest green, warm cream, soft ivory, sage, and muted brass.
- **Cinematic Hero & Editorial Storytelling (Cabana Mountain)**: Full-width photography, subtle parallax, fluid typography reveals, and restrained motion.
- **Clear Accommodation & Enquiry Pathways (Resorto)**: Interactive room showcases, category filtering, instant WhatsApp inquiry integration, direct calling (`tel:+918571801102`), and dedicated meal delivery breakdown.

---

## 🎨 Design System & Tokens

| Token Name | Hex Code | Usage |
|---|---|---|
| **Primary Forest Green** | `#193D30` | Dominant brand identity, cards, headers |
| **Deep Green** | `#102A22` | Immersive dark hero & footer backgrounds |
| **Warm Cream** | `#F4F0E5` | Editorial body sections, contrast backgrounds |
| **Soft Ivory** | `#FBF9F3` | Primary page base background |
| **Sage** | `#A8B79A` | Subtle borders, badges, tertiary accents |
| **Muted Brass** | `#B58A57` | Primary action CTAs, highlights, foil accents |
| **Primary Text** | `#202820` | High-contrast readable typography on light grounds |
| **Secondary Text** | `#74786E` | Supporting captions and editorial subtext |

### Typography
- **Headlines / Display**: *Playfair Display* & *Cormorant Garamond* (Editorial Serifs with fluid `clamp()` scaling)
- **Body / Navigation / UI**: *Plus Jakarta Sans* & *Inter* (Crisp modern sans-serif)

---

## 🗺️ Website Structure & Routes

1. **Home (`/`)**:
   - Refined Brand Wordmark & Translucent-to-Solid Navigation
   - Cinematic Hero with Ambient 3D Particle Lighting (Three.js with CSS fallback & `prefers-reduced-motion`)
   - Dual Primary CTAs: *Explore Rooms* & *Call +91-8571801102*
   - Editorial Brand Story (*The Ravinarayan Ethos*)
   - Premium Accommodation Showcase (*Dual View: Editorial Grid & Cinematic Tour*)
   - Verified Amenities (*High-Speed Wi-Fi, RO Drinking Water, 24/7 CCTV, Food Service, Laundry, Community Living*)
   - Dedicated Tiffin Service Feature
   - Strategic Location & Contact Section (Serving Met City, Yakubpur & Jhajjar)
   - Botanical Luxury Final CTA Banner
   - Comprehensive Footer with working navigation and social links

2. **About (`/about`)**:
   - The heritage and purpose of Ravinarayan in Haryana's industrial corridor
   - 4 Living Commitments: Cleanliness, Quiet Rest, Wholesome Nutrition, Owner Care
   - Authentic architectural photography

3. **Rooms / Accommodation (`/rooms`)**:
   - Showcase of all 8 room categories:
     1. Premium Single Room
     2. Deluxe Double Room
     3. Contemporary Suite
     4. Master Bedroom
     5. Shared Accommodation
     6. Comfort Deluxe
     7. Spacious Master
     8. Cozy Room
   - Category filtering (All, Single, Double, Suite, Shared)
   - Real-time room enquiry modal with WhatsApp message preparation
   - Transparent policies (no fabricated pricing or availability)

4. **Tiffin Service (`/tiffin-service`)**:
   - Fresh, hygienic, home-style meal details
   - Meal breakdown (Breakfast, Lunch, Dinner)
   - Service locations: Met City, Yakubpur, Jhajjar
   - Link to official portal (`https://tiffin.ravinarayan.in/`)
   - WhatsApp meal subscription inquiries

5. **Contact (`/contact`)**:
   - Working direct dialer link (`tel:+918571801102`)
   - Official WhatsApp helpline link
   - Instagram link (`https://www.instagram.com/ravinarayan_pg_guesthouse`)
   - Interactive general enquiry form
   - Frequently Asked Questions (FAQ) accordion

6. **SEO & Discovery**:
   - `sitemap.xml` dynamic generation (`/sitemap.xml`)
   - `robots.txt` generator (`/robots.txt`)
   - JSON-LD `LodgingBusiness` structured schema for search engines

---

## ⚡ Technical Stack & Architecture

- **Framework**: Next.js 14 (App Router) + React 18 + TypeScript
- **Styling**: Tailwind CSS + Custom CSS Variables + Responsive Fluid Typography
- **Icons**: Lucide React
- **Motion & Ambient 3D**: Three.js WebGL particle scene with pointer tracking, fallback handling, and reduced-motion accessibility
- **Future ERP Compatibility**: Clean decoupling between public static routes and future protected management portal (`erp.ravinarayan.in`)

---

## 🚀 Running the Project

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Create optimized production build
npm run build

# Start production server
npm run start
```
Server runs at `http://localhost:3000`.
