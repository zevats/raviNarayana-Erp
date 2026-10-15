export interface RoomCategory {
  id: string;
  name: string;
  tagline: string;
  description: string;
  image: string;
  highlights: string[];
  occupancyType: "Single" | "Double" | "Suite" | "Shared";
  enquiryNote: string;
}

export const roomsData: RoomCategory[] = [
  {
    id: "premium-single",
    name: "Premium Single Room",
    tagline: "Quiet privacy tailored for focused living",
    description:
      "A serene, private room with ample natural light, functional layout, and dedicated personal space designed for working professionals and students.",
    image: "/gallery/room-1.jpg",
    highlights: ["Single Occupancy", "High-Speed Wi-Fi", "RO Water Access", "Fresh Linen Support"],
    occupancyType: "Single",
    enquiryNote: "Availability and current layout options confirmed upon phone/WhatsApp enquiry.",
  },
  {
    id: "deluxe-double",
    name: "Deluxe Double Room",
    tagline: "Spacious comfort with shared ease",
    description:
      "Generously proportioned double room providing comfortable bedding, organized storage, and good cross-ventilation for co-living.",
    image: "/gallery/room-2.jpg",
    highlights: ["Double Sharing", "Ample Natural Light", "Secure Storage", "Common Area Access"],
    occupancyType: "Double",
    enquiryNote: "Ideal for colleagues or friends seeking comfortable co-living in Met City / Yakubpur.",
  },
  {
    id: "contemporary-suite",
    name: "Contemporary Suite",
    tagline: "Modern aesthetics and enhanced comfort",
    description:
      "A refined room format featuring thoughtful interior elements, integrated workspace corner, and a quiet, peaceful ambience.",
    image: "/gallery/room-3.jpg",
    highlights: ["Work Desk Setup", "Modern Lighting", "Hygienic Cleanliness", "Wi-Fi Coverage"],
    occupancyType: "Suite",
    enquiryNote: "Layout variations subject to building floor and verified availability.",
  },
  {
    id: "master-bedroom",
    name: "Master Bedroom",
    tagline: "Expanded personal retreat with dedicated storage",
    description:
      "A flagship accommodation featuring spacious dimensions, generous closet space, full-length mirror, and warm residential lighting.",
    image: "/gallery/room-4.jpg",
    highlights: ["Generous Wardrobe", "Warm Ambience", "CCTV Covered Access", "Food Service Eligible"],
    occupancyType: "Suite",
    enquiryNote: "Subject to seasonal availability. Contact directly for on-site visits.",
  },
  {
    id: "shared-accommodation",
    name: "Shared Accommodation",
    tagline: "Affordable community living without compromise",
    description:
      "Value-conscious shared rooms created for individuals who appreciate camaraderie, shared responsibility, and full access to all building amenities.",
    image: "/gallery/bedroom-5.jpg",
    highlights: ["Cost-Effective", "Daily Housekeeping", "Laundry Facility", "RO Drinking Water"],
    occupancyType: "Shared",
    enquiryNote: "Flexible monthly tenures available. Ask management for current vacancy.",
  },
  {
    id: "comfort-deluxe",
    name: "Comfort Deluxe",
    tagline: "Balanced proportions and comfortable bedding",
    description:
      "An inviting room with carefully selected furnishings, balanced lighting, and dependable ventilation to unwind after a busy workday.",
    image: "/gallery/bedroom-deluxe.jpg",
    highlights: ["Comfortable Mattress", "Clean Ventilation", "Power Backup", "Secure Premises"],
    occupancyType: "Single",
    enquiryNote: "Furnishing layout verified during personal visit.",
  },
  {
    id: "spacious-master",
    name: "Spacious Master",
    tagline: "Airy interior with room to breathe",
    description:
      "Extra floor area allowing unrestricted movement, expansive window daylight, and quiet acoustic separation from busy road corridors.",
    image: "/gallery/bedroom-spacious.jpg",
    highlights: ["Extra Floor Space", "Daylight Windows", "Dedicated Power Points", "Quiet Wing"],
    occupancyType: "Suite",
    enquiryNote: "Limited inventory. Advance reservation recommended.",
  },
  {
    id: "cozy-room",
    name: "Cozy Room",
    tagline: "Intimate, warm, and easy to maintain",
    description:
      "A snug, peaceful room engineered for restful sleep and minimalist living, with all essential utilities within arm's reach.",
    image: "/gallery/bedroom-6.jpg",
    highlights: ["Snug Layout", "Quick Heating/Cooling", "Essential Furnishings", "Budget Friendly"],
    occupancyType: "Single",
    enquiryNote: "Popular among single corporate executives on project assignments.",
  },
];
