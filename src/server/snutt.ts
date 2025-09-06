import { NextResponse } from "next/server";

/** ====== 타입 ====== */
export type SemesterValue = string | number;

export type FreeRoom = { room: string; until: number }; // until = 분(0~1440)


export type LectureTimeRaw = {
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
export type LectureRaw = {
  _id?: string;
  academic_year?: string;
  category?: string;
  class_time_json?: LectureTimeRaw[];
  classification?: string;
  credit?: number;
  department?: string;
  instructor?: string;
  lecture_number?: string;
  quota?: number;
  remark?: string;
  semester?: number | string;
  year?: number;
  course_number?: string;
  course_title?: string;
  title?: string;
  registrationCount?: number;
  wasFull?: boolean;
  place?: string;
  room?: string;
  location?: string;
};

export type LectureSlim = {
  course_title: string;
  instructor: string;
  class_time_json: LectureTimeRaw[];
  course_number: string;
  lecture_number: string;
  year?: number;
  semester?: number | string;
};

/** ====== 설정 ====== */
const PAGE_SIZE = 200;
const MAX_PAGES = 100;
const CACHE_TTL_MS =
  (Number(process.env.SNUTT_CACHE_TTL_SECONDS || "1800") || 1800) * 1000;
const RATE = {
  windowMs: Number(process.env.SNUTT_RATE_LIMIT_WINDOW_MS || "60000") || 60000,
  max: Number(process.env.SNUTT_RATE_LIMIT_MAX || "30") || 30,
};

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

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
function pickArray(data: unknown): LectureRaw[] {
  if (Array.isArray(data)) return data as LectureRaw[];
  if (isRecord(data) && Array.isArray(data.result)) return data.result as LectureRaw[];
  if (isRecord(data) && Array.isArray(data.results)) return data.results as LectureRaw[];
  if (isRecord(data) && Array.isArray(data.lectures)) return data.lectures as LectureRaw[];
  if (isRecord(data) && Array.isArray(data.items)) return data.items as LectureRaw[];
  return [];
}
function keyOf(x: LectureRaw): string {
  return (
    x._id ??
    `${x.course_number ?? ""}#${x.lecture_number ?? ""}#${x.course_title ?? x.title ?? ""}#${x.year ?? ""}#${x.semester ?? ""}`
  );
}

async function callSnutt(
  body: Record<string, unknown>,
  base: string,
  apiKey: string,
  accessToken: string,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${base}/v1/search_query`, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      accept: "*/*",
      "x-access-apikey": apiKey,
      "x-access-token": accessToken,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = text;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { data = JSON.parse(text) as unknown; } catch {}
  }
  return { status: res.status, data };
}

/** 표준 학기ID: 1=1학기, 2=여름, 3=2학기, 4=겨울 */
export function canonicalSemesterId(sem: string): string {
  const s = String(sem).trim().toUpperCase();
  if (s === "1" || s === "2" || s === "3" || s === "4") return s;
  if (s === "S") return "2";
  if (s === "W") return "4";
  if (s === "FALL" || s === "SECOND" || s === "AUTUMN") return "3";
  return s;
}
export function semesterVariantsByCanonical(canon: string): SemesterValue[] {
  switch (canon) {
    case "1": return ["1", 1];
    case "2": return ["2", 2, "S"];
    case "3": return ["3", 3, "2"];
    case "4": return ["4", 4, "W"];
    default: {
      const n = Number(canon);
      return Number.isFinite(n) ? [canon, n] : [canon];
    }
  }
}

/** 모든 페이지 수집 후 슬림화 */
async function fetchAllPagesSlim(
  base: string,
  apiKey: string,
  accessToken: string,
  year: number,
  semesterVariant: SemesterValue,
): Promise<LectureSlim[]> {
  const uniq = new Map<string, LectureRaw>();

  // offset 기반
  for (let p = 0; p < MAX_PAGES; p++) {
    const payload: Record<string, unknown> = { year, semester: semesterVariant, limit: PAGE_SIZE, offset: p * PAGE_SIZE };
    const { status, data } = await callSnutt(payload, base, apiKey, accessToken);
    if (status === 400 || status === 404) break;
    if (status >= 500) throw { status, data };
    const arr = pickArray(data);
    if (arr.length === 0) break;
    for (const it of arr) uniq.set(keyOf(it), it);
    if (arr.length < PAGE_SIZE) break;
  }
  // page 기반 (offset 무시 대비)
  if (uniq.size <= PAGE_SIZE) {
    for (let p = 0; p < MAX_PAGES; p++) {
      const payload: Record<string, unknown> = { year, semester: semesterVariant, page: p, limit: PAGE_SIZE };
      const { status, data } = await callSnutt(payload, base, apiKey, accessToken);
      if (status === 400 || status === 404) break;
      if (status >= 500) throw { status, data };
      const arr = pickArray(data);
      if (arr.length === 0) break;
      for (const it of arr) uniq.set(keyOf(it), it);
      if (arr.length < PAGE_SIZE) break;
    }
  }

  const full = Array.from(uniq.values());
  return full.map((lec) => ({
    course_title:
      typeof lec.course_title === "string" ? lec.course_title :
      (typeof lec.title === "string" ? lec.title : ""),
    instructor: typeof lec.instructor === "string" ? lec.instructor : "",
    class_time_json: Array.isArray(lec.class_time_json) ? lec.class_time_json : [],
    course_number: typeof lec.course_number === "string" ? lec.course_number : "",
    lecture_number: typeof lec.lecture_number === "string" ? lec.lecture_number : "",
    year: typeof lec.year === "number" ? lec.year : undefined,
    semester: (typeof lec.semester === "number" || typeof lec.semester === "string") ? lec.semester : undefined,
  }));
}

/** 캐시/병합 포함 핵심: 학기별 슬림 강의 목록 */
export async function getSlimLectures(
  year: number,
  semesterInput: string,
): Promise<{ data: LectureSlim[]; cache: "HIT" | "COALESCE" | "MISS" }> {
  const base = process.env.SNUTT_API_BASE || "https://snutt-api.wafflestudio.com";
  const apiKey = process.env.SNUTT_API_KEY;
  const accessToken = process.env.SNUTT_ACCESS_TOKEN;
  if (!apiKey || !accessToken) throw new Error("SNUTT credentials missing");

  const canon = canonicalSemesterId(semesterInput);
  const variants = semesterVariantsByCanonical(canon);
  const cacheKey = `${base}::${year}::${canon}`;

  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return { data: hit.data, cache: "HIT" };

  const inFlight = inflight.get(cacheKey);
  if (inFlight) {
    const data = await inFlight;
    return { data, cache: "COALESCE" };
  }

  const job: Promise<LectureSlim[]> = (async () => {
    let slim: LectureSlim[] = [];
    for (let i = 0; i < variants.length; i++) {
      slim = await fetchAllPagesSlim(base, apiKey, accessToken, year, variants[i]);
      if (slim.length > 0) break;
    }
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
  const snuttDay = jsDay === 0 ? 6 : (jsDay - 1); // 월=0..일=6
  const minute = kst.getHours() * 60 + kst.getMinutes();
  return { kst, snuttDay, minute };
}
