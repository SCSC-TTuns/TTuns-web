import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** ====== 튜닝 파라미터 ====== */
const PAGE_SIZE = 200;
const MAX_PAGES = 100;
const CACHE_TTL_MS =
  (Number(process.env.SNUTT_CACHE_TTL_SECONDS || "1800") || 1800) * 1000;
const RATE = {
  windowMs: Number(process.env.SNUTT_RATE_LIMIT_WINDOW_MS || "60000") || 60000,
  max: Number(process.env.SNUTT_RATE_LIMIT_MAX || "30") || 30,
};

/** ====== 응답/캐시 타입 ====== */
type SemesterValue = string | number;

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

type LectureRaw = {
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
  snuttEvLecture?: unknown;
  categoryPre2025?: string;
  // 일부 응답에서 상위 레벨에 장소가 있을 수도 있음
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

type CacheEntry<T> = { data: T; expiresAt: number };

/** ====== 전역 저장소(인스턴스별) ====== */
interface GlobalWithStores {
  __snuttCache?: Map<string, CacheEntry<LectureSlim[]>>;
  __snuttInflight?: Map<string, Promise<LectureSlim[]>>;
  __snuttRate?: Map<string, { count: number; resetAt: number }>;
}
const g = globalThis as unknown as GlobalWithStores;

const cache: Map<string, CacheEntry<LectureSlim[]>> = g.__snuttCache ?? new Map();
if (!g.__snuttCache) g.__snuttCache = cache;

const inflight: Map<string, Promise<LectureSlim[]>> = g.__snuttInflight ?? new Map();
if (!g.__snuttInflight) g.__snuttInflight = inflight;

type Bucket = { count: number; resetAt: number };
const buckets: Map<string, Bucket> = g.__snuttRate ?? new Map();
if (!g.__snuttRate) g.__snuttRate = buckets;

function take(ip: string): boolean {
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

/** ====== 유틸 ====== */
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
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      // ignore JSON parse error, keep text
    }
  }
  return { status: res.status, data };
}

/**
 * 표준 학기 ID로 정규화:
 * 1학기=1, 여름=2, 2학기=3, 겨울=4
 * (UI에서 1/2/3/4 또는 S/W가 들어와도 여기서 표준화)
 */
function canonicalSemesterId(sem: string): string {
  const s = String(sem).trim().toUpperCase();
  if (s === "1" || s === "2" || s === "3" || s === "4") return s;
  if (s === "S") return "2";
  if (s === "W") return "4";
  if (s === "FALL" || s === "SECOND" || s === "AUTUMN") return "3";
  return s;
}

/**
 * 정규화 ID 기준으로 SNUTT에 던질 변형 후보:
 * 1 → ["1", 1]
 * 2(여름) → ["2", 2, "S"]
 * 3(2학기) → ["3", 3, "2"]
 * 4(겨울) → ["4", 4, "W"]
 */
function semesterVariantsByCanonical(canon: string): SemesterValue[] {
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

/** 한 변형 값으로 모든 페이지 수집 후 슬림화 */
async function fetchAllPagesSlim(
  base: string,
  apiKey: string,
  accessToken: string,
  year: number,
  semesterVariant: SemesterValue,
): Promise<LectureSlim[]> {
  const uniq = new Map<string, LectureRaw>();

  // 1) offset 기반
  for (let p = 0; p < MAX_PAGES; p++) {
    const payload: Record<string, unknown> = { year, semester: semesterVariant, limit: PAGE_SIZE, offset: p * PAGE_SIZE };
    const { status, data } = await callSnutt(payload, base, apiKey, accessToken);
    if (status === 400 || status === 404) break; // 시즌/데이터 없음
    if (status >= 500) throw { status, data };

    const arr = pickArray(data);
    if (arr.length === 0) break;
    for (const it of arr) uniq.set(keyOf(it), it);
    if (arr.length < PAGE_SIZE) break;
  }

  // 2) page 기반 (offset 무시 대비)
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

  // 슬림화
  const full = Array.from(uniq.values());
  const slim: LectureSlim[] = full.map((lec) => ({
    course_title: typeof lec.course_title === "string" ? lec.course_title : (typeof lec.title === "string" ? lec.title : ""),
    instructor: typeof lec.instructor === "string" ? lec.instructor : "",
    class_time_json: Array.isArray(lec.class_time_json) ? lec.class_time_json : [],
    course_number: typeof lec.course_number === "string" ? lec.course_number : "",
    lecture_number: typeof lec.lecture_number === "string" ? lec.lecture_number : "",
    year: typeof lec.year === "number" ? lec.year : undefined,
    semester: typeof lec.semester === "number" || typeof lec.semester === "string" ? lec.semester : undefined,
  }));
  return slim;
}

/** 캐시/인플라이트 포함 핵심 */
async function getSlimLectures(
  base: string,
  apiKey: string,
  accessToken: string,
  year: number,
  semesterInput: string,
): Promise<{ data: LectureSlim[]; cache: "HIT" | "COALESCE" | "MISS" }> {
  const canon = canonicalSemesterId(semesterInput);
  const variants = semesterVariantsByCanonical(canon);
  const cacheKey = `${base}::${year}::${canon}`;

  // 1) 캐시
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return { data: hit.data, cache: "HIT" };

  // 2) 인플라이트 병합
  const existing = inflight.get(cacheKey);
  if (existing) {
    const data = await existing;
    return { data, cache: "COALESCE" };
  }

  // 3) 실제 페치
  const job: Promise<LectureSlim[]> = (async () => {
    let slim: LectureSlim[] = [];
    for (let i = 0; i < variants.length; i++) {
      slim = await fetchAllPagesSlim(base, apiKey, accessToken, year, variants[i]);
      if (slim.length > 0) break; // 첫 성공에서 중단
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

/** 공통 핸들러 */
async function handle(req: NextRequest, year: number, semester: string): Promise<NextResponse> {
  // 레이트리밋
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!take(ip)) return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });

  const base = process.env.SNUTT_API_BASE || "https://snutt-api.wafflestudio.com";
  const apiKey = process.env.SNUTT_API_KEY;
  const accessToken = process.env.SNUTT_ACCESS_TOKEN;
  if (!apiKey) return NextResponse.json({ error: "SNUTT_API_KEY missing" }, { status: 500 });
  if (!accessToken) return NextResponse.json({ error: "SNUTT_ACCESS_TOKEN missing" }, { status: 500 });
  if (!Number.isFinite(year) || !semester.trim()) {
    return NextResponse.json({ error: "year/semester required" }, { status: 400 });
  }

  try {
    const { data, cache: cacheHit } = await getSlimLectures(base, apiKey, accessToken, year, semester);
    return NextResponse.json<LectureSlim[]>(data, {
      status: 200,
      headers: {
        "x-cache": cacheHit,
        "Cache-Control": "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "upstream error" }, { status: 502 });
  }
}

/** GET: /api/snutt/search?year=2025&semester=3 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const semester = String(searchParams.get("semester") ?? "");
  return handle(req, year, semester);
}

/** POST: body {year, semester} (하위호환) */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // ignore
  }
  const rec = (isRecord(body) ? body : {}) as Record<string, unknown>;
  const yearVal = rec.year as number | string | undefined;
  const semVal = rec.semester as string | number | undefined;

  const year = Number(yearVal);
  const semester = String(semVal ?? "");
  return handle(req, year, semester);
}
