import React from "react";
import type { Metadata } from "next";
import { StatusPage } from "@/components/feedback/StatusPage";

export const metadata: Metadata = { title: "Page not found" };

/** 404 for any address that does not exist (also used by notFound()). */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#FAF8F5]">
      <StatusPage code="404" title="Page not found" message="This page does not exist or has moved. Check the address, or go back home." />
    </main>
  );
}
