export type AnyLecture = Record<string, any>;

export type DayIndex = 0|1|2|3|4|5|6;
export const DAY_LABELS = ["월","화","수","목","금","토","일"] as const;
const DAYS = [0,1,2,3,4,5,6] as const;

/** 완전 일치: 양끝 공백만 무시(대소문자/하이픈은 그대로 비교) */
const strictEq = (a?: any, b?: any) =>
  String(a ?? "").trim() === String(b ?? "").trim();

export function extractProfessor(lec: AnyLecture): string {
  if (typeof lec?.instructor === "string") return lec.instructor;
  if (Array.isArray(lec?.instructors)) return lec.instructors.join(", ");
  return "";
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

export function lectureMatchesProfessorExact(lec: AnyLecture, q: string): boolean {
  if (!q) return false;
  return strictEq(extractProfessor(lec), q);
}

export function lectureMatchesRoomExact(lec: AnyLecture, q: string): boolean {
  if (!q) return false;
  return allRooms(lec).some((r) => strictEq(r, q));
}

export type TimetableEvent = {
  day: DayIndex;
  start: number;
  end: number;
  title: string;
  professor?: string;
  room?: string;
  courseNumber?: string;
  lectureNumber?: string;
};

function toDayIndex(d: any): DayIndex {
  const n = Number(d);
  return (n >= 0 && n <= 6 ? n : 0) as DayIndex;
}

export function buildEventsFromLectures(
  lectures: AnyLecture[],
  opts: { showBy: "professor" | "room"; query: string }
): TimetableEvent[] {
  const out: TimetableEvent[] = [];
  for (const lec of lectures) {
    const title = lec?.course_title || lec?.title || "";
    const prof = extractProfessor(lec);
    const rooms = allRooms(lec);
    const matchedRoom = rooms.find((r) => strictEq(r, opts.query));
    const times = Array.isArray(lec?.class_time_json) ? lec.class_time_json : [];

    for (const t of times) {
      const day = toDayIndex(t?.day);
      const start = Number(t?.startMinute ?? 0);
      const end = Number(t?.endMinute ?? 0);
      if (!start && !end) continue;

      out.push({
        day,
        start,
        end,
        title,
        professor: prof,
        room: matchedRoom || (t?.place || rooms[0] || ""),
        courseNumber: lec?.course_number,
        lectureNumber: lec?.lecture_number,
      });
    }
  }
  return out;
}

export type LaidOutEvent = TimetableEvent & { col: number; colCount: number };

export function layoutByDay(events: TimetableEvent[]): Record<DayIndex, LaidOutEvent[]> {
  const byDay: Record<DayIndex, TimetableEvent[]> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
  events.forEach((e) => { byDay[e.day].push(e); });

  const laid: Record<DayIndex, LaidOutEvent[]> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]};

  DAYS.forEach((d) => {
    const list = byDay[d].slice().sort((a,b) => a.start - b.start || a.end - b.end);
    const lanesEnd: number[] = [];
    const placed: LaidOutEvent[] = [];

    for (const e of list) {
      let lane = 0;
      while (lane < lanesEnd.length && lanesEnd[lane] > e.start) lane++;
      if (lane === lanesEnd.length) lanesEnd.push(0);
      lanesEnd[lane] = e.end;
      placed.push({ ...e, col: lane, colCount: 0 });
    }
    const colCount = Math.max(1, lanesEnd.length);
    laid[d] = placed.map(p => ({ ...p, colCount }));
  });

  return laid;
}

export function timeBounds(events: TimetableEvent[]): { startMin: number; endMin: number } {
  if (!events.length) return { startMin: 8*60, endMin: 22*60 };
  const mins = events.flatMap(e => [e.start, e.end]);
  const min = Math.min(...mins);
  const max = Math.max(...mins);
  return { startMin: Math.min(min, 8*60), endMin: Math.max(max, 22*60) };
}
