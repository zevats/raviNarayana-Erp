import type { Metadata, Viewport } from "next";
import "./globals.css";
import { siteConfig } from "@/data/siteConfig";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#102A22",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "Ravinarayan PG Guesthouse | Botanical Luxury Living & Tiffin Service",
    template: "%s | Ravinarayan PG Guesthouse",
  },
  description: siteConfig.description,
  keywords: [
    "PG in Metcity",
    "PG in Yakubpur",
    "PG in Jhajjar",
    "Ravinarayan PG",
    "guesthouse in Jhajjar",
    "student PG Haryana",
    "working professional PG Met City",
    "tiffin service Met City",
    "single room PG Yakubpur",
  ],
  authors: [{ name: siteConfig.name }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: siteConfig.url,
    title: "Ravinarayan PG Guesthouse | Botanical Living & Tiffin Service",
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: "/hero-bg.jpg",
        width: 1200,
        height: 630,
        alt: "Ravinarayan PG Guesthouse in Met City, Yakubpur and Jhajjar",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ravinarayan PG Guesthouse | Met City & Jhajjar",
    description: siteConfig.description,
    images: ["/hero-bg.jpg"],
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: siteConfig.name,
    image: `${siteConfig.url}/hero-bg.jpg`,
    telephone: siteConfig.phone,
    url: siteConfig.url,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Yakubpur / Met City",
      addressRegion: "Haryana",
      addressCountry: "IN",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: siteConfig.coordinates.lat,
      longitude: siteConfig.coordinates.lng,
    },
    amenityFeature: siteConfig.amenities.map((a) => ({
      "@type": "LocationFeatureSpecification",
      name: a.title,
      value: true,
    })),
  };

  return (
    <html lang="en-IN" className="scroll-smooth">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="antialiased selection:bg-brass selection:text-forest-dark bg-ivory text-charcoal">
        {children}
      </body>
    </html>
  );
}
