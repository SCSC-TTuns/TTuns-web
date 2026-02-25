import type { DayIndex } from "@/lib/lectureSchedule";

export type TimetableRenderMode = "professor" | "room";

export type EventBlock = {
  start: number;
  end: number;
  day: DayIndex;
  title: string;
  professor?: string;
  room?: string;
};

export type FreeRoom = {
  room: string;
  until: number;
};

export type NearbyBuildingPoint = {
  building: string;
  buildingName: string;
  lat: number;
  lon: number;
  distanceMeters: number;
  dxMeters: number;
  dyMeters: number;
  freeRoomCount: number;
  topUntil: number;
  rooms: FreeRoom[];
};

export type LabelRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PlotNode = {
  building: string;
  item: NearbyBuildingPoint;
  x: number;
  y: number;
  labelRect: LabelRect;
};

export function pointInRect(x: number, y: number, rect: LabelRect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function fmtTime(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtDistance(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)}km`;
  return `${Math.round(meters)}m`;
}

export function isEventBlock(value: unknown): value is EventBlock {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.day === "number" &&
    typeof row.start === "number" &&
    typeof row.end === "number" &&
    typeof row.title === "string" &&
    (typeof row.professor === "string" || row.professor === undefined) &&
    (typeof row.room === "string" || row.room === undefined)
  );
}

export function isFreeRoom(value: unknown): value is FreeRoom {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.room === "string" && typeof row.until === "number";
}

export function isNearbyBuildingPoint(value: unknown): value is NearbyBuildingPoint {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.building === "string" &&
    typeof row.buildingName === "string" &&
    typeof row.lat === "number" &&
    typeof row.lon === "number" &&
    typeof row.distanceMeters === "number" &&
    typeof row.dxMeters === "number" &&
    typeof row.dyMeters === "number" &&
    typeof row.freeRoomCount === "number" &&
    typeof row.topUntil === "number" &&
    Array.isArray(row.rooms)
  );
}
