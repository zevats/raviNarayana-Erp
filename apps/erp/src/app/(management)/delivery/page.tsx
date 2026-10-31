"use client";

import React from "react";
import { useCurrentUser } from "@/components/auth/CurrentUserContext";
import { ManagerDelivery } from "@/modules/delivery/ops/ManagerDelivery";
import { StaffDelivery } from "@/modules/delivery/ops/StaffDelivery";

/**
 * Delivery: one page, laid out for who is using it.
 * - Delivery staff: their own stops on the phone (next stop first), their cash, their history.
 * - Manager: the day's board by delivery person, problems, custody verification, close-out.
 * - Owner: the same, opening on the close-out and read-only unless they choose to make changes.
 * The server enforces every permission; the layout only decides what is shown.
 */
export default function DeliveryPage() {
  // The signed-in user comes from the server-rendered shell; no /api/auth/me round-trip.
  const user = useCurrentUser();
  if (!user) return null;
  return user.role === "DELIVERY_PERSON" ? <StaffDelivery user={user} /> : <ManagerDelivery user={user} />;
}
