import type { SubscriptionMealTypes } from "@/types";

/**
 * How a plan's meals read on screen: "Lunch + dinner" (a 2-meal plan: one thali at each), "Any meal"
 * (a 1-thali plan the customer takes at lunch or dinner, by order), or a single fixed meal.
 */
export function planMealsLabel(m: SubscriptionMealTypes | string | null | undefined): string {
  switch (m) {
    case "BOTH":
      return "Lunch + dinner";
    case "ANY":
      return "1 thali a day, any meal";
    case "LUNCH":
      return "Lunch";
    case "DINNER":
      return "Dinner";
    case "BREAKFAST":
      return "Breakfast (no longer offered)";
    default:
      return String(m || "—");
  }
}

/** Whether a plan includes this meal (an any-meal plan includes both). */
export function planCoversMeal(m: SubscriptionMealTypes | string | null | undefined, meal: string): boolean {
  return m === "BOTH" || m === "ANY" || m === meal;
}
