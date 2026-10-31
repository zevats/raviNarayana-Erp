import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { PwaRegistrar } from "@/components/pwa/PwaRegistrar";
import { NativeBridge } from "@/components/native/NativeBridge";

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
    <html lang="en" className="h-full">
      <body className="min-h-full bg-[#FAF8F5] text-[#1A2E20] font-sans antialiased selection:bg-[#B58A57]/25 selection:text-[#1A2E20]">
        <PwaRegistrar />
        <NativeBridge />
        {children}
      </body>
    </html>
  );
}
