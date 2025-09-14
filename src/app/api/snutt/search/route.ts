import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSlimLectures } from "@/server/snutt";

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
  const mode = (u.searchParams.get("mode") || "") as "professor" | "room" | "";
  const q = String(u.searchParams.get("q") || "").trim();
  if (!year || !semester) throw new Error("missing year/semester");
  return { year, semester, mode, q };
}

function rowsForUpsert(year: number, semester: string, lectures: any[]) {
  return lectures.map((L) => {
    const times: any[] = Array.isArray(L?.class_time_json) ? L.class_time_json : [];
    const rooms = times.map((t: any) => String(t?.place ?? t?.room ?? t?.location ?? "").trim()).filter(Boolean);
    const instructor = String(L?.instructor ?? L?.professor ?? "").trim() || null;
    return {
      snutt_id: String(L?._id ?? `${L?.course_number ?? ""}#${L?.lecture_number ?? ""}`),
      year,
      semester: Number(semester),
      instructor,
      department: String(L?.department ?? L?.dept ?? "").trim() || null,
      title: String(L?.course_title ?? L?.title ?? "").trim() || null,
      room_list: rooms.length ? rooms : null,
      class_time_json: times.length ? times : null,
      doc: L,
      // 선택: instructor_norm 컬럼이 있으면 여기에 넣어도 됨 (아래 3번 참고)
    };
  });
}

async function ensureSemesterCached(year: number, semester: string, dbg: string[]) {
  const { count, error } = await supa
    .from("lecture_cache")
    .select("snutt_id", { count: "exact", head: true })
    .eq("year", year)
    .eq("semester", Number(semester));
  if (error) throw error;
  dbg.push(`head_count=${count ?? 0}`);
  if (!count) {
    const { data } = await getSlimLectures(year, semester);
    dbg.push(`snutt_fetch=${Array.isArray(data) ? data.length : 0}`);
    const rows = rowsForUpsert(year, semester, data);
    for (let i = 0; i < rows.length; i += 1000) {
      await supa.from("lecture_cache").upsert(rows.slice(i, i + 1000), {
        onConflict: "snutt_id,year,semester",
      });
    }
  }
}

export async function GET(req: NextRequest) {
  const dbg: string[] = [];
  try {
    const { year, semester, mode, q } = parse(req);
    dbg.push(`params y=${year} s=${semester} m=${mode} q='${q}'`);

    await ensureSemesterCached(year, semester, dbg);

    let query = supa
      .from("lecture_cache")
      .select("doc", { count: "exact" })
      .eq("year", year)
      .eq("semester", Number(semester));

    if (mode === "professor" && q) {
      // 정확 일치
      query = query.eq("instructor", q);
      dbg.push("filter=instructor.eq");
    } else if (mode === "room" && q) {
      // 정확 일치 (text[] 포함)
      query = query.contains("room_list", [q]);
      dbg.push("filter=room_list.contains");
    } else {
      dbg.push("filter=none");
    }

    const { data, error, count } = await query;
    if (error) throw error;
    dbg.push(`db_count=${count ?? data?.length ?? 0}`);

    const res = NextResponse.json((data || []).map((r: any) => r.doc), { status: 200 });
    res.headers.set("x-tt-debug", dbg.join(" | "));
    return res;
  } catch (e: any) {
    dbg.push(`fatal=${e?.message || e}`);
    const res = NextResponse.json({ error: e?.message || "internal" }, { status: 500 });
    res.headers.set("x-tt-debug", dbg.join(" | "));
    return res;
  }
}
