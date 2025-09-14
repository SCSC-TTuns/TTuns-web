import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function parse(req: NextRequest) {
  const u = new URL(req.url);
  const year = Number(u.searchParams.get("year") || "");
  const semester = String(u.searchParams.get("semester") || "").trim();
  const building = String(u.searchParams.get("building") || "").trim();
  const day = Number(u.searchParams.get("day") || "");
  const at = String(u.searchParams.get("at") || "09:00");
  const [h, m] = at.split(":").map((x) => Number(x));
  const atMin = (h || 0) * 60 + (m || 0);
  if (!year || !semester || !building || Number.isNaN(day)) throw new Error("missing params");
  return { year, semester, building, day, atMin };
}

function toMin(v: any) {
  if (typeof v === "number" && isFinite(v)) return v;
  const s = String(v ?? "");
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

type FreeRoom = { room: string; until: number };

function computeFree(list: any[], building: string, day: number, atMin: number): FreeRoom[] {
  const occ: Record<string, Array<{ s: number; e: number }>> = {};
  for (const L of list) {
    const times: any[] = Array.isArray(L?.class_time_json) ? L.class_time_json : [];
    for (const t of times) {
      const d = Number(t?.day ?? t?.dayOfWeek ?? -1);
      if (d !== day) continue;
      const room = String(t?.place ?? t?.room ?? t?.location ?? "").trim();
      if (!room || !room.startsWith(`${building}-`)) continue;
      const s = toMin(t?.startMinute ?? t?.start_minute ?? t?.start ?? t?.start_time);
      const e = toMin(t?.endMinute ?? t?.end_minute ?? t?.end ?? t?.end_time);
      (occ[room] ||= []).push({ s, e });
    }
  }
  const out: FreeRoom[] = [];
  for (const r of Object.keys(occ).sort()) {
    const blocks = occ[r].sort((a, b) => a.s - b.s);
    if (blocks.some((b) => atMin >= b.s && atMin < b.e)) continue;
    let until = 24 * 60;
    for (const b of blocks) { if (b.s > atMin) { until = b.s; break; } }
    out.push({ room: r, until });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const dbg: string[] = [];
  try {
    const { year, semester, building, day, atMin } = parse(req);
    dbg.push(`params y=${year} s=${semester} b=${building} d=${day} at=${atMin}`);

    const { data, error, count } = await supa
      .from("lecture_cache")
      .select("class_time_json", { count: "exact" })
      .eq("year", year)
      .eq("semester", Number(semester))
      .not("class_time_json", "is", null);

    if (error) {
      console.error("[free-rooms] select error:", error);
      throw error;
    }
    dbg.push(`db_rows=${count ?? data?.length ?? 0}`);

    const free = computeFree(data || [], building, day, atMin);
    const res = NextResponse.json(free, { status: 200 });
    res.headers.set("x-tt-debug", dbg.join(" | "));
    return res;
  } catch (e: any) {
    dbg.push(`fatal=${e?.message || e}`);
    const res = NextResponse.json({ error: e?.message || "internal" }, { status: 500 });
    res.headers.set("x-tt-debug", dbg.join(" | "));
    console.error("[free-rooms] fatal:", e);
    return res;
  }
}
