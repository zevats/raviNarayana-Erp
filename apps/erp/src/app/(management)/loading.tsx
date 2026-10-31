import React from "react";
import { FullPageLoader } from "@/components/feedback/FullPageLoader";

/** Shown while a page opens: the scooter in the middle of the visible area, never half-drawn content. */
export default function ManagementLoading() {
  return <FullPageLoader label="Opening…" />;
}
