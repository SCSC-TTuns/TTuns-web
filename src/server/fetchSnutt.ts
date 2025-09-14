// 서버 전용: SNUTT에서 학기 전체 강의 배열을 가져오고, Supabase 저장 로우로 매핑
type AnyLecture = any;

function canonicalSemesterId(sem: string): string {
  const s = String(sem).trim().toUpperCase();
  if (["1","2","3","4"].includes(s)) return s;
  if (s === "S") return "2";
  if (s === "W") return "4";
  if (s === "FALL" || s === "SECOND" || s === "AUTUMN") return "3";
  return s;
}

function pickArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export async function fetchSnuttLectures(year: number, semester: string): Promise<AnyLecture[]> {
  const base = (process.env.SNUTT_API_BASE || "https://snutt-api.wafflestudio.com").replace(/\/+$/, "");
  const apiKey = process.env.SNUTT_API_KEY;
  const accessToken = process.env.SNUTT_ACCESS_TOKEN || process.env.SNUTT_DEFAULT_TOKEN || "";
  if (!apiKey || !accessToken) throw new Error("SNUTT credentials missing");

  const canon = canonicalSemesterId(semester);
  const PAGE_SIZE = 500;               // 크게 한 번씩 당겨 속도↑
  const MAX_PAGES = 30;                // 안전 가드
  const TIMEOUT_MS = 12000;            // 각 요청 타임아웃

  const controller = new AbortController();
  const all: AnyLecture[] = [];

  for (let p = 0; p < MAX_PAGES; p++) {
    const body = { year, semester: canon, limit: PAGE_SIZE, offset: p * PAGE_SIZE };

    const tm = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
      signal: controller.signal,
    }).catch((e) => { throw new Error(`SNUTT fetch error: ${e?.message || e}`); });
    clearTimeout(tm);

    const text = await res.text();
    if (!res.ok) throw new Error(`SNUTT ${res.status}: ${text.slice(0,120)}`);

    let json: any = text;
    try { json = JSON.parse(text); } catch {}
    const arr = pickArray(json);

    all.push(...arr);
    if (arr.length < PAGE_SIZE) break; // 마지막 페이지
  }

  return all;
}

/** Supabase에 upsert할 row 매핑 (원본은 doc로 보관) */
export function mapLectureRows(year: number, semester: string, lectures: AnyLecture[]) {
  return lectures.map((L: any) => {
    const times: any[] = Array.isArray(L?.class_time_json) ? L.class_time_json : [];
    const rooms = times.map((t) => String(t?.place ?? t?.room ?? "").trim()).filter(Boolean);
    return {
      snutt_id: String(L?._id ?? L?.id ?? `${L?.course_number ?? ""}#${L?.lecture_number ?? ""}`),
      year,
      semester: Number(semester),
      instructor: String(L?.instructor ?? L?.professor ?? "").trim() || null,
      department: String(L?.department ?? L?.dept ?? "").trim() || null,
      title: String(L?.title ?? L?.course_title ?? L?.name ?? "").trim() || null,
      room_list: rooms.length ? rooms : null,
      class_time_json: times.length ? times : null,
      doc: L,
    };
  });
}
