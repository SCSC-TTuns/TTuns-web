import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  canonicalSemesterId,
  FreeRoom,
  getSlimLectures,
  jsonError,
  nowKst,
  take,
} from "@/server/snutt";
import { parseHHmm, toMinuteRange } from "@/lib/lectureShared";

export const runtime = "nodejs";

type MinuteRange = { s: number; e: number };
type RecoBaseItem = { room: string; until: number; building: string };
type BuildingCoord = { id: string; name: string; lat: number; lon: number };
type BuildingDataset = { byId: Map<string, BuildingCoord>; idsByPrefix: string[] };
type RecoRoomScored = RecoBaseItem & {
  buildingName: string;
  lat: number;
  lon: number;
  distanceMeters: number;
  dxMeters: number;
  dyMeters: number;
};
type RecoBuildingPoint = {
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

interface GlobalStores {
  __recoBuildingDataset?: BuildingDataset;
  __recoBuildingDatasetInflight?: Promise<BuildingDataset>;
  __recoBaseCache?: Map<string, { data: RecoBaseItem[]; expiresAt: number }>;
}
const g = globalThis as unknown as GlobalStores;

const recoBaseCache =
  g.__recoBaseCache ?? new Map<string, { data: RecoBaseItem[]; expiresAt: number }>();
if (!g.__recoBaseCache) g.__recoBaseCache = recoBaseCache;

/** "301-118, 301-119 / 301-201" -> ["301-118","301-119","301-201"] */
function splitPlaces(p: string): string[] {
  return p
    .split(/[,\s/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 방 이름만: "301-118" -> "118", "301-B119" -> "B119" */
function roomLabel(room: string): string {
  const idx = room.indexOf("-");
  return idx >= 0 ? room.slice(idx + 1) : room;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function loadBuildingDataset(): Promise<BuildingDataset> {
  const csvPath = path.join(process.cwd(), "dev", "snu_buildings_with_coords.csv");
  const text = await readFile(csvPath, "utf-8");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) throw new Error("building coordinate csv is empty");

  const header = parseCsvLine(lines[0].replace(/^\uFEFF/u, ""));
  const idxId = header.indexOf("동번호");
  const idxName = header.indexOf("동(건물)명");
  const idxLat = header.indexOf("위도");
  const idxLon = header.indexOf("경도");
  if (idxId < 0 || idxName < 0 || idxLat < 0 || idxLon < 0) {
    throw new Error("building coordinate csv header is invalid");
  }

  const byId = new Map<string, BuildingCoord>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const id = String(cols[idxId] ?? "").trim();
    const name = String(cols[idxName] ?? "").trim();
    const lat = Number(cols[idxLat]);
    const lon = Number(cols[idxLon]);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    byId.set(id, { id, name, lat, lon });
  }

  if (byId.size === 0) throw new Error("no building coordinates");

  const idsByPrefix = Array.from(byId.keys()).sort(
    (a, b) => b.length - a.length || a.localeCompare(b)
  );
  return { byId, idsByPrefix };
}

async function getBuildingDataset(): Promise<BuildingDataset> {
  if (g.__recoBuildingDataset) return g.__recoBuildingDataset;
  if (g.__recoBuildingDatasetInflight) return g.__recoBuildingDatasetInflight;

  const job = loadBuildingDataset();
  g.__recoBuildingDatasetInflight = job;
  try {
    const data = await job;
    g.__recoBuildingDataset = data;
    return data;
  } finally {
    g.__recoBuildingDatasetInflight = undefined;
  }
}

/** 긴 접두사 우선 매칭: 16-1, 43-2 같은 동번호 우선 */
function resolveBuildingId(room: string, idsByPrefix: string[]): string | null {
  const r = room.trim();
  for (const id of idsByPrefix) {
    if (r === id || r.startsWith(`${id}-`)) return id;
  }
  return null;
}

/** Haversine 거리(m) */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toCartesianMeters(originLat: number, originLon: number, lat: number, lon: number) {
  const metersPerLat = 111_320;
  const metersPerLon = 111_320 * Math.cos((originLat * Math.PI) / 180);
  const dxMeters = (lon - originLon) * metersPerLon;
  const dyMeters = (lat - originLat) * metersPerLat;
  return { dxMeters, dyMeters };
}

function buildRecommendationBase(
  lectures: Array<{ class_time_json?: any[] }>,
  day: number,
  slot: number,
  idsByPrefix: string[]
): RecoBaseItem[] {
  const allRooms = new Set<string>();
  const rangesByRoom = new Map<string, MinuteRange[]>();

  for (const lec of lectures) {
    const times = Array.isArray(lec.class_time_json) ? lec.class_time_json : [];
    for (const t of times) {
      const placeRaw = String(t?.place || t?.room || t?.location || "");
      if (!placeRaw) continue;

      const tokens = splitPlaces(placeRaw);
      for (const token of tokens) allRooms.add(token);

      if (Number(t?.day) !== day) continue;
      const rng = toMinuteRange(t as any);
      if (!rng) continue;

      for (const token of tokens) {
        const arr = rangesByRoom.get(token) ?? [];
        arr.push(rng);
        rangesByRoom.set(token, arr);
      }
    }
  }

  const END_OF_DAY = 24 * 60;
  const free: RecoBaseItem[] = [];

  for (const room of allRooms) {
    const building = resolveBuildingId(room, idsByPrefix);
    if (!building) continue;

    const ranges = (rangesByRoom.get(room) ?? []).sort((a, b) => a.s - b.s || a.e - b.e);

    let occupied = false;
    for (const r of ranges) {
      if (r.s <= slot && slot < r.e) {
        occupied = true;
        break;
      }
    }
    if (occupied) continue;

    let until = END_OF_DAY;
    for (const r of ranges) {
      if (r.s >= slot) {
        until = r.s;
        break;
      }
    }
    free.push({ room, until, building });
  }

  return free;
}

/** GET /api/snutt/recommendation/location?year=2025&semester=3&lat=37.46&lon=126.95&day=0&at=13:40&limit=20&radiusMeters=500 */
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!take(ip)) return jsonError("Too Many Requests", 429);

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const semester = String(searchParams.get("semester") ?? "").trim();
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const dayParam = searchParams.get("day");
  const atParam = searchParams.get("at");
  const limitParam = searchParams.get("limit");
  const radiusParam = searchParams.get("radiusMeters");
  const formatParam = String(searchParams.get("format") ?? "");

  if (!Number.isFinite(year) || !semester) return jsonError("year/semester required", 400);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return jsonError("lat/lon required", 400);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return jsonError("invalid lat/lon", 400);

  let limit = 20;
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isFinite(n) || n <= 0) return jsonError("invalid limit", 400);
    limit = Math.min(100, Math.max(1, Math.floor(n)));
  }

  let radiusMeters: number | null = null;
  if (radiusParam !== null) {
    const n = Number(radiusParam);
    if (!Number.isFinite(n) || n <= 0) return jsonError("invalid radiusMeters", 400);
    radiusMeters = n;
  }

  let day: number;
  let minute: number;
  if (dayParam || atParam) {
    const base = nowKst();
    if (dayParam !== null) {
      const n = Number(dayParam);
      if (!Number.isFinite(n)) return jsonError("invalid day", 400);
      day = Math.max(0, Math.min(6, Math.trunc(n)));
    } else {
      day = base.snuttDay;
    }
    minute = atParam ? (parseHHmm(atParam) ?? base.minute) : base.minute;
  } else {
    const base = nowKst();
    day = base.snuttDay;
    minute = base.minute;
  }

  const canon = canonicalSemesterId(semester);
  const slot = Math.floor(minute / 5) * 5;
  const baseKey = `reco-base:${year}:${canon}:${day}:${slot}`;

  let dataset: BuildingDataset;
  try {
    dataset = await getBuildingDataset();
  } catch {
    return jsonError("coordinate data unavailable", 500);
  }

  let cacheState: "HIT" | "MISS" = "MISS";
  let baseItems: RecoBaseItem[] = [];
  const hit = recoBaseCache.get(baseKey);
  if (hit && hit.expiresAt > Date.now()) {
    baseItems = hit.data;
    cacheState = "HIT";
  } else {
    try {
      const { data: lectures } = await getSlimLectures(year, semester);
      baseItems = buildRecommendationBase(lectures, day, slot, dataset.idsByPrefix);
      recoBaseCache.set(baseKey, { data: baseItems, expiresAt: Date.now() + 60_000 });
    } catch {
      return jsonError("upstream error", 502);
    }
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  const scored = baseItems
    .map((item) => {
      const b = dataset.byId.get(item.building);
      if (!b) return null;
      const distanceMeters = haversineMeters(lat, lon, b.lat, b.lon);
      const { dxMeters, dyMeters } = toCartesianMeters(lat, lon, b.lat, b.lon);
      return {
        ...item,
        buildingName: b.name,
        lat: b.lat,
        lon: b.lon,
        distanceMeters,
        dxMeters,
        dyMeters,
      } satisfies RecoRoomScored;
    })
    .filter((v): v is RecoRoomScored => v !== null);

  const filtered =
    radiusMeters === null ? scored : scored.filter((item) => item.distanceMeters <= radiusMeters);

  filtered.sort(
    (a, b) =>
      a.distanceMeters - b.distanceMeters ||
      b.until - a.until ||
      collator.compare(roomLabel(a.room), roomLabel(b.room))
  );

  if (formatParam === "buildings") {
    const grouped = new Map<string, RecoRoomScored[]>();
    for (const item of filtered) {
      const arr = grouped.get(item.building) ?? [];
      arr.push(item);
      grouped.set(item.building, arr);
    }

    const points: RecoBuildingPoint[] = Array.from(grouped.entries()).map(([, rows]) => {
      const lead = rows[0];
      const rooms = rows
        .slice()
        .sort((a, b) => b.until - a.until || collator.compare(roomLabel(a.room), roomLabel(b.room)))
        .map((r) => ({ room: r.room, until: r.until }));
      return {
        building: lead.building,
        buildingName: lead.buildingName,
        lat: lead.lat,
        lon: lead.lon,
        distanceMeters: lead.distanceMeters,
        dxMeters: lead.dxMeters,
        dyMeters: lead.dyMeters,
        freeRoomCount: rows.length,
        topUntil: rooms[0]?.until ?? 0,
        rooms,
      };
    });

    points.sort(
      (a, b) =>
        a.distanceMeters - b.distanceMeters ||
        b.topUntil - a.topUntil ||
        collator.compare(a.building, b.building)
    );

    return NextResponse.json(points.slice(0, limit), {
      headers: { "x-cache": cacheState, "Cache-Control": "public, max-age=30, s-maxage=60" },
    });
  }

  const result: FreeRoom[] = filtered.slice(0, limit).map(({ room, until }) => ({ room, until }));
  return NextResponse.json(result, {
    headers: { "x-cache": cacheState, "Cache-Control": "public, max-age=30, s-maxage=60" },
  });
}
