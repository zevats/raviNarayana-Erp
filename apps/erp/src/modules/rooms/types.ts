/**
 * Rooms & Occupancy Contract & Boundaries (Phase 3 Foundation)
 */

export type RoomType = "SINGLE" | "DOUBLE_SHARING" | "EXECUTIVE_SUITE";
export type RoomStatus = "VACANT" | "OCCUPIED" | "MAINTENANCE" | "RESERVED";

export interface RoomRecord {
  id: string;
  roomNumber: string;
  floor: number;
  type: RoomType;
  capacity: number;
  currentOccupancy: number;
  baseRentMonthly: number;
  status: RoomStatus;
}
