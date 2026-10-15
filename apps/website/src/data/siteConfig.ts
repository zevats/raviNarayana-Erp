export const siteConfig = {
  name: "Ravinarayan PG Guesthouse",
  tagline: "Botanical Luxury Living & Fresh Tiffin Service",
  description:
    "Ravinarayan PG Guesthouse offers premium single and shared accommodation with modern amenities in Met City, Yakubpur, and Jhajjar, Haryana. Enjoy high-speed Wi-Fi, RO water, 24/7 CCTV, home-style meals, and laundry.",
  url: "https://ravinarayan.in",
  phone: "+91-8571801102",
  phoneRaw: "+918571801102",
  whatsappUrl:
    "https://wa.me/918571801102?text=Hello%20Ravinarayan%20Team%2C%20I%20would%20like%20to%20enquire%20about%20room%20availability%20and%20tiffin%20service.",
  tiffinPortalUrl: "https://tiffin.ravinarayan.in/",
  instagramUrl:
    "https://www.instagram.com/ravinarayan_pg_guesthouse?igsh=N3M2NjZwZThkbTdy",
  locations: ["Met City", "Yakubpur", "Jhajjar, Haryana"],
  coordinates: {
    lat: 28.5355, // Met City / Jhajjar area
    lng: 76.7728,
  },
  amenities: [
    {
      id: "wifi",
      title: "High-Speed Wi-Fi",
      subtitle: "Uninterrupted connectivity",
      description: "Dedicated high-bandwidth internet tailored for remote work, streaming, and student study.",
      icon: "Wifi",
      badge: "Included with every room",
    },
    {
      id: "water",
      title: "RO Drinking Water",
      subtitle: "Pure & purified",
      description: "Multi-stage reverse osmosis purified water dispensers available 24/7 across every floor.",
      icon: "Droplets",
      badge: "24/7 Supply",
    },
    {
      id: "security",
      title: "CCTV & 24/7 Security",
      subtitle: "Safe & guarded premises",
      description: "Continuous camera coverage of all common areas and secure entry access for total peace of mind.",
      icon: "ShieldCheck",
      badge: "Continuous Surveillance",
    },
    {
      id: "food",
      title: "Nutritious Food Service",
      subtitle: "Fresh & home-cooked",
      description: "Hygienically prepared balanced meals for breakfast, lunch, and dinner, cooked fresh daily.",
      icon: "UtensilsCrossed",
      badge: "Daily Meal Options",
    },
    {
      id: "laundry",
      title: "Laundry Service",
      subtitle: "Clean linens & clothes",
      description: "In-house laundry machines and facilities to keep your wardrobe fresh with zero stress.",
      icon: "Shirt",
      badge: "Free Facility",
    },
    {
      id: "community",
      title: "Community Living",
      subtitle: "Warm, respectful atmosphere",
      description: "A peaceful residential environment surrounded by fellow professionals and focused scholars.",
      icon: "Users",
      badge: "Friendly Environment",
    },
  ],
  navLinks: [
    { name: "Home", href: "/" },
    { name: "About", href: "/about" },
    { name: "Rooms", href: "/rooms" },
    { name: "Tiffin Service", href: "/tiffin-service" },
    { name: "Contact", href: "/contact" },
  ],
};
