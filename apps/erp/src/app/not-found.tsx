import React from "react";
import type { Metadata } from "next";
import { StatusPage } from "@/components/feedback/StatusPage";

export const metadata: Metadata = { title: "Page not found" };

/** 404 for any address that does not exist (also used by notFound()). */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#FAF8F5]">
      <StatusPage code="404 · Page not found" title="This road doesn’t go anywhere" message="The page you opened does not exist or has moved. Check the address, or head back home." />
    </main>
  );
}
