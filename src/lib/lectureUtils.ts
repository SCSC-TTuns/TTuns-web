export type AnyLecture = Record<string, any>;

const norm = (s?: any) =>
  (s ?? "").toString().toLowerCase().replace(/[\s\u200b\-_.(),/\\[\]{}・·:;|]+/g, "");

// 한글 초성 보조(교수명 검색 강화)
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function toChosung(str: string) {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) out += CHO[Math.floor((code - 0xac00) / 588)] || ch;
    else out += ch;
  }
  return out;
}

export function extractProfAndRoom(lec: AnyLecture) {
  const professor =
    (typeof lec?.instructor === "string" && lec.instructor) ||
    (Array.isArray(lec?.instructors) && lec.instructors.filter(Boolean).join(", ")) ||
    "";
  const roomTop = lec?.place || lec?.room || lec?.location || "";
  const roomFromTimes = Array.isArray(lec?.class_time_json)
    ? (lec.class_time_json.map((t: any) => t?.place || t?.room || t?.location).find(Boolean) || "")
    : "";
  return { professor, room: roomTop || roomFromTimes };
}

export function allRooms(lec: AnyLecture): string[] {
  const set = new Set<string>();
  const top = lec?.place || lec?.room || lec?.location;
  if (typeof top === "string" && top.trim()) set.add(top.trim());
  if (Array.isArray(lec?.class_time_json)) {
    for (const t of lec.class_time_json) {
      const p = t?.place || t?.room || t?.location;
      if (typeof p === "string" && p.trim()) set.add(p.trim());
    }
  }
  return [...set];
}

type MatchOpts = { exact?: boolean };

/** 교수명 매칭: exact=true면 '완전 일치'(공백/대소문자/구분기호 무시), false면 부분 일치 */
export function profMatches(lec: AnyLecture, q: string, opts?: MatchOpts) {
  if (!q) return true;
  const prof = extractProfAndRoom(lec).professor || "";
  const np = norm(prof), nq = norm(q);
  if (opts?.exact) return np === nq || toChosung(prof) === toChosung(q); // 초성 완전일치도 허용
  return np.includes(nq) || toChosung(prof).includes(toChosung(q));
}

/** 강의실 매칭: exact=true면 후보 중 하나가 '완전 일치'해야 통과 */
export function roomMatches(lec: AnyLecture, q: string, opts?: MatchOpts) {
  if (!q) return true;
  const nq = norm(q);
  const rooms = allRooms(lec).map(norm);
  return opts?.exact ? rooms.includes(nq) : rooms.some((r) => r.includes(nq));
}

/** 표시용 강의실: exact=true면 정확히 맞은 방을 우선 표시 */
export function bestRoomForQuery(lec: AnyLecture, q: string, opts?: MatchOpts) {
  const rooms = allRooms(lec);
  if (!q || rooms.length === 0) return rooms[0] || "";
  const nq = norm(q);
  const exact = rooms.find((r) => norm(r) === nq);
  if (exact) return exact;
  if (!opts?.exact) {
    const part = rooms.find((r) => norm(r).includes(nq));
    if (part) return part;
  }
  return rooms[0] || "";
}
