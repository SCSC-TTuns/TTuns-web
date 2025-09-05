import { NextRequest, NextResponse } from "next/server";

/** ====== 튜닝 파라미터 ====== */
const PAGE_SIZE = 200;
const MAX_PAGES = 100;
const CACHE_TTL_MS =
  (Number(process.env.SNUTT_CACHE_TTL_SECONDS || "1800") || 1800) * 1000;
const RATE = {
  windowMs: Number(process.env.SNUTT_RATE_LIMIT_WINDOW_MS || "60000") || 60000,
  max: Number(process.env.SNUTT_RATE_LIMIT_MAX || "30") || 30,
};

/** ====== 메모리 캐시 / 인플라이트 / 레이트리밋 ====== */
type CacheEntry = { data: any; expiresAt: number };
const g = globalThis as any;
const cache: Map<string, CacheEntry> = g.__snuttCache ?? new Map();
if (!g.__snuttCache) g.__snuttCache = cache;

const inflight: Map<string, Promise<any>> = g.__snuttInflight ?? new Map();
if (!g.__snuttInflight) g.__snuttInflight = inflight;

type Bucket = { count: number; resetAt: number };
const buckets: Map<string, Bucket> = g.__snuttRate ?? new Map();
if (!g.__snuttRate) g.__snuttRate = buckets;

function take(ip: string) {
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
function pickArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.lectures)) return data.lectures;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function keyOf(x: any) {
  return (
    x?._id ??
    `${x?.course_number ?? ""}#${x?.lecture_number ?? ""}#${x?.course_title ?? ""}#${x?.year ?? ""}#${x?.semester ?? ""}`
  );
}

async function callSnutt(body: any, base: string, apiKey: string, accessToken: string) {
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
  let data: any = text;
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    try { data = JSON.parse(text); } catch {}
  }
  return { status: res.status, data };
}

/**
 * 표준 학기 ID로 정규화:
 * 1학기=1, 여름=2, 2학기=3, 겨울=4
 * (UI가 "1/S/2/W" 또는 숫자 "1/2/3/4"를 보내도 여기서 표준화)
 */
function canonicalSemesterId(sem: string): string {
  const s = String(sem).trim().toUpperCase();
  // 숫자 그대로 들어오면 그대로 수용
  if (s === "1" || s === "2" || s === "3" || s === "4") return s;
  // 문자 입력 매핑
  if (s === "S") return "2"; // 여름
  if (s === "W") return "4"; // 겨울
  // 혹시 "2"(UI 의미: 2학기)를 받아 오면 3으로 올림 (방어코드)
  if (s === "FALL" || s === "SECOND" || s === "AUTUMN") return "3";
  return s; // 알 수 없으면 있는 그대로
}

/**
 * 정규화 ID 기준으로 SNUTT에 던질 변형 후보 생성
 * - 1 → ["1", 1]
 * - 2(여름) → ["2", 2, "S"]
 * - 3(2학기) → ["3", 3, "2"]   ← 2학기=3 반영
 * - 4(겨울) → ["4", 4, "W"]
 */
function semesterVariantsByCanonical(canon: string): (string | number)[] {
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

/** 한 변형으로 모든 페이지 수집하여 슬림화 */
async function fetchAllPagesSlim(
  base: string,
  apiKey: string,
  accessToken: string,
  year: number,
  semesterVariant: string | number,
) {
  const uniq = new Map<string, any>();

  // 1) offset 기반
  for (let p = 0; p < MAX_PAGES; p++) {
    const payload = { year, semester: semesterVariant, limit: PAGE_SIZE, offset: p * PAGE_SIZE };
    const { status, data } = await callSnutt(payload, base, apiKey, accessToken);
    if (status === 400 || status === 404) break; // 시즌/데이터 없음 → 탈출
    if (status >= 500) throw { status, data };

    const arr = pickArray(data);
    if (!arr.length) break;
    for (const it of arr) uniq.set(keyOf(it), it);
    if (arr.length < PAGE_SIZE) break;
  }

  // 2) page 기반 (offset 무시 대비)
  if (uniq.size <= PAGE_SIZE) {
    for (let p = 0; p < MAX_PAGES; p++) {
      const payload = { year, semester: semesterVariant, page: p, limit: PAGE_SIZE };
      const { status, data } = await callSnutt(payload, base, apiKey, accessToken);
      if (status === 400 || status === 404) break;
      if (status >= 500) throw { status, data };

      const arr = pickArray(data);
      if (!arr.length) break;
      for (const it of arr) uniq.set(keyOf(it), it);
      if (arr.length < PAGE_SIZE) break;
    }
  }

  const full = Array.from(uniq.values());
  const slim = full.map((lec) => ({
    course_title: lec?.course_title ?? lec?.title ?? "",
    instructor: lec?.instructor ?? "",
    class_time_json: Array.isArray(lec?.class_time_json) ? lec.class_time_json : [],
    course_number: lec?.course_number ?? "",
    lecture_number: lec?.lecture_number ?? "",
    year: lec?.year,
    semester: lec?.semester,
  }));
  return slim;
}

/** 캐시/인플라이트 포함 핵심 로직 */
async function getSlimLectures(base: string, apiKey: string, accessToken: string, year: number, semesterInput: string) {
  const canon = canonicalSemesterId(semesterInput);
  const variants = semesterVariantsByCanonical(canon);

  // 캐시 키는 "표준화 ID"로 통일 → S/2/3 등 서로 다른 입력도 같은 캐시 쓰게
  const cacheKey = `${base}::${year}::${canon}`;

  // 1) 캐시
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return { data: hit.data, cache: "HIT" as const };

  // 2) 인플라이트 병합
  if (inflight.has(cacheKey)) {
    const data = await inflight.get(cacheKey)!;
    return { data, cache: "COALESCE" as const };
  }

  // 3) 실제 페치
  const job = (async () => {
    let slim: any[] = [];
    for (let i = 0; i < variants.length; i++) {
      slim = await fetchAllPagesSlim(base, apiKey, accessToken, year, variants[i]);
      if (slim.length > 0) break; // 첫 성공 지점에서 멈춤(부하 최소화)
    }
    cache.set(cacheKey, { data: slim, expiresAt: Date.now() + CACHE_TTL_MS });
    return slim;
  })();

  inflight.set(cacheKey, job);
  try {
    const data = await job;
    return { data, cache: "MISS" as const };
  } finally {
    inflight.delete(cacheKey);
  }
}

/** 공통 핸들러 */
async function handle(req: NextRequest, year: number, semester: string) {
  // 레이트리밋
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!take(ip)) return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });

  const base = process.env.SNUTT_API_BASE || "https://snutt-api.wafflestudio.com";
  const apiKey = process.env.SNUTT_API_KEY;
  const accessToken = process.env.SNUTT_ACCESS_TOKEN;
  if (!apiKey) return NextResponse.json({ error: "SNUTT_API_KEY missing" }, { status: 500 });
  if (!accessToken) return NextResponse.json({ error: "SNUTT_ACCESS_TOKEN missing" }, { status: 500 });
  if (!year || !semester?.trim()) return NextResponse.json({ error: "year/semester required" }, { status: 400 });

  try {
    const { data, cache: cacheHit } = await getSlimLectures(base, apiKey, accessToken, year, semester);
    return NextResponse.json(data, {
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

/** GET: /api/snutt/search?year=2025&semester=2|S|3|... */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const semester = String(searchParams.get("semester") ?? "");
  return handle(req, year, semester);
}

/** POST: body {year, semester} (하위호환) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const year = Number(body?.year);
  const semester = String(body?.semester ?? "");
  return handle(req, year, semester);
}
