import React from "react";
import { BikeLoader } from "@/components/feedback/BikeLoader";

/** Shown while a page opens: one calm loading stage instead of half-drawn content. */
export default function ManagementLoading() {
  return <BikeLoader label="Opening…" size="lg" className="min-h-[60vh] select-none" />;
}
