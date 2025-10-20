import { NextRequest, NextResponse } from "next/server";
import {
  getSlimLectures,
  canonicalSemesterId,
  jsonError,
  nowKst,
  take,
  freeRoomsCache,
  FreeRoom,
} from "@/server/snutt";

export const runtime = "nodejs";

/** "HH:mm" → 분 */
function parseHHmm(s?: string): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]),
    mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

/** SNUTT 시간 블록을 안전하게 분 범위로 */
function toMinuteRange(t: {
  startMinute?: number;
  endMinute?: number;
  start_time?: string;
  end_time?: string;
  start?: number;
  len?: number;
}): { s: number; e: number } | null {
  if (typeof t.startMinute === "number" && typeof t.endMinute === "number")
    return { s: t.startMinute, e: t.endMinute };

  const ps = parseHHmm(t.start_time),
    pe = parseHHmm(t.end_time);
  if (ps !== null && pe !== null) return { s: ps, e: pe };

  if (typeof t.start === "number" && typeof t.len === "number") {
    const s = Math.round((8 + t.start) * 60);
    const e = Math.round(s + t.len * 60);
    return { s, e };
  }
  return null;
}

/** "301-118, 301-119 / 301-201" → ["301-118","301-119","301-201"] */
function splitPlaces(p: string): string[] {
  return p
    .split(/[,\s/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 방 이름만: "301-118" → "118", "301-B119" → "B119", 
 * "71-1-101" -> "101", "301-113-2" -> "113-2"*/
function parsePlace(place: string): { building: string; room: string } | null {
  const lastDashIndex = place.lastIndexOf("-");
  const partAfterLastDash = place.substring(lastDashIndex + 1);

  let splitIndex = lastDashIndex;

  if (partAfterLastDash.length === 1) {
    const secondLastDashIndex = place.lastIndexOf("-", lastDashIndex - 1);
    
    if (secondLastDashIndex !== -1) {
      splitIndex = secondLastDashIndex;
    }
  }

  const building = place.substring(0, splitIndex);
  const room = place.substring(splitIndex + 1);

  if (!building || !room) return null; // not parsed
  return { building, room };
}


/** 호실 번호만 추출: "301-113-2" → "113-2", "71-1-101" → "101" */
function roomLabel(place: string): string {
  const parsed = parsePlace(place);
  if (parsed) {
    return parsed.room;
  }
  // if not parsed
  const idx = place.lastIndexOf("-");
  return idx >= 0 ? place.slice(idx + 1) : place;
}

/** GET /api/snutt/free-rooms?year=2025&semester=3&building=301&day=0&at=13:40 */
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!take(ip)) return jsonError("Too Many Requests", 429);

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const semester = String(searchParams.get("semester") ?? "");
  const building = String(searchParams.get("building") ?? "").trim();
  const dayParam = searchParams.get("day");
  const atParam = searchParams.get("at");

  if (!Number.isFinite(year) || !semester.trim()) return jsonError("year/semester required", 400);
  if (!building) return jsonError("building required", 400);

  // 기준 시각/요일(KST)
  let day: number, minute: number;
  if (dayParam || atParam) {
    const base = nowKst();
    day = dayParam !== null ? Math.max(0, Math.min(6, Number(dayParam))) : base.snuttDay;
    minute = atParam ? (parseHHmm(atParam) ?? base.minute) : base.minute;
  } else {
    const base = nowKst();
    day = base.snuttDay;
    minute = base.minute;
  }

  // 5분 단위 파생 캐시
  const canon = canonicalSemesterId(semester);
  const slot = Math.floor(minute / 5) * 5;
  const key = `free:${year}:${canon}:${building}:${day}:${slot}`;
  const hit = freeRoomsCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json(hit.data, {
      headers: { "x-cache": "HIT", "Cache-Control": "public, max-age=30, s-maxage=60" },
    });
  }

  try {
    const { data: lectures } = await getSlimLectures(year, semester);

    // 1) 전체 학기에서 해당 "동"에 등장하는 모든 강의실 목록
    const allRooms = new Set<string>();
    for (const lec of lectures) {
      const times = Array.isArray(lec.class_time_json) ? lec.class_time_json : [];
      for (const t of times) {
        const placeRaw = (t.place || "") as string;
        if (!placeRaw) continue;
        for (const token of splitPlaces(placeRaw)) {
          if (token.startsWith(`${building}-`)) allRooms.add(token);
        }
      }
    }

    // 2) 요청 요일의 시간 블록만 방별로 모음
    const rangesByRoom = new Map<string, { s: number; e: number }[]>();
    for (const lec of lectures) {
      const times = Array.isArray(lec.class_time_json) ? lec.class_time_json : [];
      for (const t of times) {
        if (Number(t.day) !== day) continue;
        const rng = toMinuteRange(t as any);
        if (!rng) continue;
        const placeRaw = (t.place || "") as string;
        if (!placeRaw) continue;
        for (const token of splitPlaces(placeRaw)) {
          if (!token.startsWith(`${building}-`)) continue;
          const arr = rangesByRoom.get(token) ?? [];
          arr.push(rng);
          rangesByRoom.set(token, arr);
        }
      }
    }

    // 3) 각 방에 대해 "현재 비어있는가"와 "~몇 시까지" 계산
    const END_OF_DAY = 24 * 60;
    const free: FreeRoom[] = [];

    for (const room of allRooms) {
      const ranges = (rangesByRoom.get(room) ?? []).sort((a, b) => a.s - b.s || a.e - b.e);

      // 현재 점유?  [s, e) (끝 시각 비포함)
      let occupied = false;
      for (const r of ranges) {
        if (r.s <= minute && minute < r.e) {
          occupied = true;
          break;
        }
      }
      if (occupied) continue;

      // 다음 시작 시각 (없으면 24:00)
      let until = END_OF_DAY;
      for (const r of ranges) {
        if (r.s >= minute) {
          until = r.s;
          break;
        }
      }
      free.push({ room, until });
    }

    // 4) 강의실 이름(하이픈 뒤) 기준 자연 정렬
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    free.sort((a, b) => collator.compare(roomLabel(a.room), roomLabel(b.room)));

    // 5) 짧은 캐시(60초)
    freeRoomsCache.set(key, { data: free, expiresAt: Date.now() + 60_000 });

    return NextResponse.json(free, {
      headers: { "x-cache": "MISS", "Cache-Control": "public, max-age=30, s-maxage=60" },
    });
  } catch {
    return jsonError("upstream error", 502);
  }
}
