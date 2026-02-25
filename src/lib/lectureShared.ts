export function parseHHmm(s?: string): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Robustly parse time range from various SNUTT-like shapes into minutes [s,e). */
export function toMinuteRange(t: any): { s: number; e: number } | null {
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
