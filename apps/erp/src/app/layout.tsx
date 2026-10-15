import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1A2E20",
};

export const metadata: Metadata = {
  title: {
    default: "Ravinarayan ERP | Operations Management",
    template: "%s | Ravinarayan ERP",
  },
  description: "Internal Operations & Management System for Ravinarayan PG Guesthouse.",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
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
        {children}
      </body>
    </html>
  );
}
