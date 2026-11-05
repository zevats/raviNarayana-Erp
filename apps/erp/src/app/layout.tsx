import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "@/styles/globals.css";
import "@/styles/glass.css";
import "@/styles/kit.css";
import { PwaRegistrar } from "@/components/pwa/PwaRegistrar";
import { NativeBridge } from "@/components/native/NativeBridge";

// Brand sans (Plus Jakarta Sans, @ravinarayan/brand). Only defines --font-rn-display; the manager
// shell (.rn-app) uses it, so the delivery staff app and sign-in keep their current type.
const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-rn-display", display: "swap" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1A2E20",
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "Ravinarayan ERP | Operations Management",
    template: "%s | Ravinarayan ERP",
  },
  description: "Internal Operations & Management System for Ravinarayan PG Guesthouse.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Ravi Narayana",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  formatDetection: {
    telephone: false,
  },
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: "/logo.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`h-full ${display.variable}`}>
      <body className="min-h-full bg-[#FAF8F5] text-[#1A2E20] font-sans antialiased selection:bg-[#B58A57]/25 selection:text-[#1A2E20]">
        <PwaRegistrar />
        <NativeBridge />
        {children}
      </body>
    </html>
  );
}
