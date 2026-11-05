import React from "react";
import { FullPageLoader } from "@/components/feedback/FullPageLoader";

/**
 * Shown while Delivery opens (the delivery staff app lives here): the scooter in the middle of the
 * visible area, never half-drawn content. The other manager sections have no loading boundary: the
 * shell marks the clicked section and shows the progress bar at once, and the current page stays
 * until the next one is ready (a boundary adds React's 300 ms minimum fallback time to every open).
 */
export default function DeliveryLoading() {
  return <FullPageLoader label="Opening…" />;
}
