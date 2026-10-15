/**
 * Delivery Module Contract & Boundaries (Phase 6 Foundation)
 */

export type DeliveryStatus =
  | "PENDING_ASSIGNMENT"
  | "DISPATCHED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "FAILED"
  | "CUSTOMER_UNAVAILABLE";

export interface DeliveryTask {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  mealType: "BREAKFAST" | "LUNCH" | "DINNER";
  quantity: number;
  assignedStaffId: string | null;
  status: DeliveryStatus;
  failureReason?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  reconciledAt?: string;
}

export const VALID_DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING_ASSIGNMENT: ["DISPATCHED"],
  DISPATCHED: ["IN_TRANSIT"],
  IN_TRANSIT: ["DELIVERED", "FAILED", "CUSTOMER_UNAVAILABLE"],
  DELIVERED: [],
  FAILED: ["DISPATCHED"],
  CUSTOMER_UNAVAILABLE: ["DISPATCHED"],
};
