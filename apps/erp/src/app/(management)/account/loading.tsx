import React from "react";
import { FullPageLoader } from "@/components/feedback/FullPageLoader";

/** Shown while My account opens (also used by the delivery staff app); see delivery/loading.tsx. */
export default function AccountLoading() {
  return <FullPageLoader label="Opening…" />;
}
