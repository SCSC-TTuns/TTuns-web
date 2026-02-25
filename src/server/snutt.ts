import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/** ====== 타입 ====== */
export type FreeRoom = { room: string; until: number }; // until = 분(0~1440)

type LectureTimeRaw = {
  day: number | string;
  place?: string;
  room?: string;
  location?: string;
  startMinute?: number;
  endMinute?: number;
  start_time?: string;
  end_time?: string;
  len?: number;
  start?: number;
};

type LectureSlim = {
  course_title: string;
  instructor: string;
  class_time_json: LectureTimeRaw[];
  course_number: string;
  lecture_number: string;
  department: string;
  year?: number;
  semester?: number | string;
};

/** ====== 설정 ====== */
const CACHE_TTL_MS = (Number(process.env.SNUTT_CACHE_TTL_SECONDS || "1800") || 1800) * 1000;
const RATE = {
  windowMs: Number(process.env.SNUTT_RATE_LIMIT_WINDOW_MS || "60000") || 60000,
  max: Number(process.env.SNUTT_RATE_LIMIT_MAX || "30") || 30,
};
const LOCAL_DATA_DIR =
  process.env.SNUTT_LOCAL_DATA_DIR || path.join(process.cwd(), "data", "sugang");

/** ====== 전역 저장소 ====== */
interface GlobalStores {
  __snuttCache?: Map<string, { data: LectureSlim[]; expiresAt: number }>;
  __snuttInflight?: Map<string, Promise<LectureSlim[]>>;
  __snuttRate?: Map<string, { count: number; resetAt: number }>;
  __freeRoomsCache?: Map<string, { data: FreeRoom[]; expiresAt: number }>;
}
const g = globalThis as unknown as GlobalStores;

const cache = g.__snuttCache ?? new Map<string, { data: LectureSlim[]; expiresAt: number }>();
if (!g.__snuttCache) g.__snuttCache = cache;

const inflight = g.__snuttInflight ?? new Map<string, Promise<LectureSlim[]>>();
if (!g.__snuttInflight) g.__snuttInflight = inflight;

const buckets = g.__snuttRate ?? new Map<string, { count: number; resetAt: number }>();
if (!g.__snuttRate) g.__snuttRate = buckets;

export const freeRoomsCache =
  g.__freeRoomsCache ?? new Map<string, { data: FreeRoom[]; expiresAt: number }>();
if (!g.__freeRoomsCache) g.__freeRoomsCache = freeRoomsCache;

/** ====== 공통 유틸 ====== */
export function take(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + RATE.windowMs });
    return true;
  }
  if (b.count >= RATE.max) return false;
  b.count++;
  return true;
}

/** 표준 학기ID: 1=1학기, 2=여름, 3=2학기, 4=겨울 */
export function canonicalSemesterId(sem: string): string {
  const raw = String(sem ?? "").trim();
  if (!raw) return "";

  const compact = raw.replace(/\s+/g, "");
  const upper = compact.toUpperCase();

  if (upper === "1" || upper === "2" || upper === "3" || upper === "4") return upper;
  if (upper === "S") return "2";
  if (upper === "W") return "4";
  if (upper === "FALL" || upper === "SECOND" || upper === "AUTUMN") return "3";

  if (upper.includes("SPRING")) return "1";
  if (upper.includes("SUMMER")) return "2";
  if (upper.includes("FALL") || upper.includes("AUTUMN")) return "3";
  if (upper.includes("WINTER")) return "4";
  if (upper.includes("FIRSTSEMESTER") || upper.includes("1STSEMESTER")) return "1";
  if (upper.includes("SECONDSEMESTER") || upper.includes("2NDSEMESTER")) return "3";

  if (compact.includes("1학기")) return "1";
  if (compact.includes("2학기")) return "3";
  if (compact.includes("봄")) return "1";
  if (compact.includes("여름")) return "2";
  if (compact.includes("가을")) return "3";
  if (compact.includes("겨울")) return "4";

  const trailingTerm = compact.match(/(?:^|[^0-9])([1-4])$/);
  if (trailingTerm) return trailingTerm[1];

  return upper;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeClassTimeRaw(raw: unknown): LectureTimeRaw | null {
  const rec = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : null;
  if (!rec) return null;

  const day =
    typeof rec.day === "number" || typeof rec.day === "string" ? (rec.day as number | string) : 0;

  const out: LectureTimeRaw = { day };

  const place = toStringOrEmpty(rec.place);
  if (place) out.place = place;

  const room = toStringOrEmpty(rec.room);
  if (room) out.room = room;

  const location = toStringOrEmpty(rec.location);
  if (location) out.location = location;

  const startMinute = toNumberOrUndefined(rec.startMinute);
  if (startMinute !== undefined) out.startMinute = startMinute;

  const endMinute = toNumberOrUndefined(rec.endMinute);
  if (endMinute !== undefined) out.endMinute = endMinute;

  const startTime = toStringOrEmpty(rec.start_time);
  if (startTime) out.start_time = startTime;

  const endTime = toStringOrEmpty(rec.end_time);
  if (endTime) out.end_time = endTime;

  const len = toNumberOrUndefined(rec.len);
  if (len !== undefined) out.len = len;

  const start = toNumberOrUndefined(rec.start);
  if (start !== undefined) out.start = start;

  return out;
}

function normalizeLectureSlim(raw: unknown, year: number, semester: string): LectureSlim {
  const rec = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};

  const classTimeJson = Array.isArray(rec.class_time_json)
    ? rec.class_time_json
        .map((t) => normalizeClassTimeRaw(t))
        .filter((t): t is LectureTimeRaw => t !== null)
    : [];

  return {
    course_title: toStringOrEmpty(rec.course_title),
    instructor: toStringOrEmpty(rec.instructor),
    class_time_json: classTimeJson,
    course_number: toStringOrEmpty(rec.course_number),
    lecture_number: toStringOrEmpty(rec.lecture_number),
    department: toStringOrEmpty(rec.department),
    year: toNumberOrUndefined(rec.year) ?? year,
    semester:
      typeof rec.semester === "number" || typeof rec.semester === "string"
        ? (rec.semester as number | string)
        : semester,
  };
}

async function loadLocalSlimLectures(year: number, semesterCanon: string): Promise<LectureSlim[]> {
  const filePath = path.join(LOCAL_DATA_DIR, `${year}-${semesterCanon}.json`);

  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return [];
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return parsed.map((row) => normalizeLectureSlim(row, year, semesterCanon));
}

/** 캐시/병합 포함 핵심: 학기별 슬림 강의 목록 */
export async function getSlimLectures(
  year: number,
  semesterInput: string
): Promise<{ data: LectureSlim[]; cache: "HIT" | "COALESCE" | "MISS" }> {
  const canon = canonicalSemesterId(semesterInput);
  const cacheKey = `local::${year}::${canon}`;

  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return { data: hit.data, cache: "HIT" };

  const inFlight = inflight.get(cacheKey);
  if (inFlight) {
    const data = await inFlight;
    return { data, cache: "COALESCE" };
  }

  const job: Promise<LectureSlim[]> = (async () => {
    const slim = await loadLocalSlimLectures(year, canon);
    cache.set(cacheKey, { data: slim, expiresAt: Date.now() + CACHE_TTL_MS });
    return slim;
  })();

  inflight.set(cacheKey, job);
  try {
    const data = await job;
    return { data, cache: "MISS" };
  } finally {
    inflight.delete(cacheKey);
  }
}

/** 공통 에러 응답 */
export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Asia/Seoul 기준 요일/분 계산 */
export function nowKst() {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const jsDay = kst.getDay(); // 0=Sun..6=Sat
  const snuttDay = jsDay === 0 ? 6 : jsDay - 1; // 월=0..일=6
  const minute = kst.getHours() * 60 + kst.getMinutes();
  return { kst, snuttDay, minute };
}
