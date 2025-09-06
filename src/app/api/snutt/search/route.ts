import { NextRequest, NextResponse } from "next/server";
import { getSlimLectures, jsonError, take } from "@/server/snutt";

export const runtime = "nodejs";

async function handle(req: NextRequest, year: number, semester: string) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!take(ip)) return jsonError("Too Many Requests", 429);
  if (!Number.isFinite(year) || !semester.trim()) return jsonError("year/semester required", 400);

  try {
    const { data, cache } = await getSlimLectures(year, semester);
    return NextResponse.json(data, {
      headers: {
        "x-cache": cache,
        "Cache-Control": "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400",
      },
    });
  } catch {
    return jsonError("upstream error", 502);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const semester = String(searchParams.get("semester") ?? "");
  return handle(req, year, semester);
}

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try { body = await req.json(); } catch {}
  const rec = (typeof body === "object" && body) ? (body as Record<string, unknown>) : {};
  const year = Number(rec.year);
  const semester = String(rec.semester ?? "");
  return handle(req, year, semester);
}
