/**
 * Kitchen & Meal Prep Boundaries (Phase 5 Foundation)
 */

export interface DailyMealPreparationSummary {
  date: string;
  breakfastCount: number;
  lunchCount: number;
  dinnerCount: number;
  specialDietCount: number;
  packedCount: number;
  dispatchedCount: number;
  isLocked: boolean;
}
