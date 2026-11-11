"use client";

import React from "react";
import { FullPageLoader } from "@/components/feedback/FullPageLoader";
import { useCurrentUser } from "@/components/auth/CurrentUserContext";
import { AccountSkeleton } from "@/components/layout/shell/AccountSkeleton";

/** Shown while My account opens: the page's cards for Owner and Manager; the delivery staff app keeps its loader. */
export default function AccountLoading() {
  const user = useCurrentUser();
  if (user && user.role !== "DELIVERY_PERSON") return <AccountSkeleton />;
  return <FullPageLoader label="Opening…" />;
}
