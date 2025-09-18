export type AnyLecture = Record<string, any>;

export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

const normalizeSearchTerm = (value?: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

/** String equality ignoring whitespace and casing */
export const strictEq = (a?: unknown, b?: unknown) =>
  normalizeSearchTerm(a) === normalizeSearchTerm(b);

export function extractProfessor(lec: AnyLecture): string {
  if (typeof lec?.instructor === "string") return lec.instructor;
  if (Array.isArray(lec?.instructors)) return lec.instructors.filter(Boolean).join(", ");
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

/** Robustly parse time range from various SNUTT-like shapes into minutes [s,e). */
export function toMinuteRange(t: any): { s: number; e: number } | null {
  const parseHHmm = (s?: string): number | null => {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  };

  if (typeof t?.startMinute === "number" && typeof t?.endMinute === "number")
    return { s: t.startMinute, e: t.endMinute };

  const ps = parseHHmm(t?.start_time);
  const pe = parseHHmm(t?.end_time);
  if (ps !== null && pe !== null) return { s: ps, e: pe };

  if (typeof t?.start === "number" && typeof t?.len === "number") {
    const s = Math.round((8 + t.start) * 60);
    const e = Math.round(s + t.len * 60);
    return { s, e };
  }
  return null;
}
