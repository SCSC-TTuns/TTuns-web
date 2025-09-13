"use client";

import { useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import type { DayIndex } from "@/lib/lectureSchedule";
import {
  AnyLecture,
  DAY_LABELS,
  lectureMatchesProfessorExact,
  lectureMatchesRoomExact,
  buildEventsFromLectures,
  layoutByDay,
  timeBounds,
} from "@/lib/lectureSchedule";
import "./page.css";

type Mode = "professor" | "room" | "free";
type FreeRoom = { room: string; until: number };

type EventBlock = {
  start: number;
  end: number;
  day: DayIndex;
  title: string;
  professor: string;
  room: string;
  col: number;
  colCount: number;
};

type Laid = Partial<Record<DayIndex, EventBlock[]>>;

const VISIBLE_DAYS: DayIndex[] = [0, 1, 2, 3, 4, 5];

function colorForTitle(title: string) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  return { fill: `hsla(${h}, 85%, 96%, 1)`, stroke: `hsl(${h}, 70%, 42%)` };
}
function fmtTime(min: number) {
  const h = Math.floor(min / 60),
    m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function fmtHHMM(min: number) {
  return fmtTime(min);
}

function nowKst() {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const jsDay = kst.getDay();
  const snuttDay = (jsDay === 0 ? 6 : jsDay - 1) as DayIndex;
  const minute = kst.getHours() * 60 + kst.getMinutes();
  const hh = String(kst.getHours()).padStart(2, "0");
  const mm = String(kst.getMinutes()).padStart(2, "0");
  return { snuttDay, minute, hhmm: `${hh}:${mm}` };
}

function extractDept(lec: any): string {
  return (
    lec?.department || lec?.dept || lec?.college || lec?.collegeName || lec?.major || lec?.org || ""
  );
}

function lectureHasTime(lec: any, ev: EventBlock) {
  const times: any[] = Array.isArray(lec?.class_time_json) ? lec.class_time_json : [];
  return times.some((t) => {
    const day = Number(t?.day ?? t?.dayOfWeek ?? -1);
    const s = Number(t?.startMinute ?? t?.start_minute ?? t?.start ?? -1);
    const e = Number(t?.endMinute ?? t?.end_minute ?? t?.end ?? -1);
    const place = String(t?.place ?? t?.room ?? "");
    return day === ev.day && s === ev.start && e === ev.end && place === ev.room;
  });
}

const JOINT_RE = /(연계|연합|협동)/;

function groupDepts(uniqueDepts: string[]) {
  const list = Array.from(new Set(uniqueDepts.map((s) => s.trim()).filter(Boolean)));
  const joint = list.filter((d) => JOINT_RE.test(d));
  const base = list.filter((d) => !JOINT_RE.test(d));
  if (list.length === 0) return { mode: "dropdown" as const, options: [] as string[] };
  if (base.length === 1) {
    const label = base[0];
    const include = new Set<string>([label, ...joint]);
    return { mode: "collapsed" as const, label, include };
  }
  return { mode: "dropdown" as const, options: list };
}

export default function TimetablePage() {
  const [year, setYear] = useState("2025");
  const [semester, setSemester] = useState("3");
  const [mode, setMode] = useState<Mode>("room");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const [events, setEvents] = useState<EventBlock[]>([]);
  const [freeRooms, setFreeRooms] = useState<FreeRoom[]>([]);
  const [copied, setCopied] = useState<string>("");

  const [collapsed, setCollapsed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelMaxH, setPanelMaxH] = useState<number>(520);

  const [deptOptions, setDeptOptions] = useState<string[]>([]);
  const [dept, setDept] = useState<string>("");
  const [deptInclude, setDeptInclude] = useState<string[] | null>(null);
  const [profFiltered, setProfFiltered] = useState<AnyLecture[]>([]);

  const [activeLectures, setActiveLectures] = useState<AnyLecture[]>([]);
  const [sel, setSel] = useState<{ ev: EventBlock; lec?: AnyLecture } | null>(null);

  const [PPM, setPPM] = useState(1.1);
  const laid = layoutByDay(events) as Laid;
  const { startMin, endMin } = timeBounds(events);

  const semesterCacheRef = useRef(new Map<string, AnyLecture[]>());
  const lastSearchRef = useRef<{ q: string; year: string; semester: string; mode: Mode } | null>(
    null
  );
  const autoCollapseRef = useRef<number>(0);

  useLayoutEffect(() => {
    if (!panelRef.current) return;
    const el = panelRef.current;
    requestAnimationFrame(() => setPanelMaxH(el.scrollHeight));
  }, [collapsed, mode, year, semester, q, deptOptions.length]);

  useEffect(() => {
    const update = () => {
      const isMobile = window.innerWidth < 720;
      if (!isMobile) {
        setPPM(1.1);
        return;
      }
      const range = Math.max(endMin - startMin, 12 * 60);
      const target = Math.max(340, Math.min(520, window.innerHeight * 0.62));
      const ppm = Math.max(0.7, Math.min(1.15, target / range));
      setPPM(ppm);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [startMin, endMin]);

  useEffect(() => {
    const url = `/api/snutt/search?year=${encodeURIComponent(
      Number(year)
    )}&semester=${encodeURIComponent(semester)}`;
    fetch(url).catch(() => {});
  }, [year, semester]);

  const canSearch = useMemo(() => !!year && !!semester && q.trim().length > 0, [year, semester, q]);

  const semesterLabel = useMemo(() => {
    const m: Record<string, string> = {
      "1": "1학기",
      "2": "여름학기",
      "3": "2학기",
      "4": "겨울학기",
    };
    return m[String(semester)] || String(semester);
  }, [semester]);

  const modeLabel = useMemo(() => {
    return mode === "professor" ? "교수명" : mode === "room" ? "강의실" : "빈 강의실";
  }, [mode]);

  useEffect(() => {
    setDept("");
    setDeptOptions([]);
    setDeptInclude(null);
    setProfFiltered([]);
    setActiveLectures([]);
    setEvents([]);
    setFreeRooms([]);
    setSel(null);
  }, [mode, year, semester]);

  const onSearch = async () => {
    if (!canSearch) return;
    setLoading(true);
    setCopied("");
    setDept("");
    setDeptOptions([]);
    setDeptInclude(null);
    setProfFiltered([]);
    lastSearchRef.current = { q: q.trim(), year, semester, mode };
    autoCollapseRef.current = Date.now();

    try {
      if (mode === "free") {
        const k = nowKst();
        const url = `/api/snutt/free-rooms?year=${encodeURIComponent(
          Number(year)
        )}&semester=${encodeURIComponent(semester)}&building=${encodeURIComponent(q.trim())}&day=${
          k.snuttDay
        }&at=${k.hhmm}`;
        const res = await fetch(url);
        const data: unknown = await res.json();

        if (!res.ok || !Array.isArray(data)) {
          setFreeRooms([]);
          alert((data as { error?: string })?.error || "불러오기 실패");
          return;
        }
        setFreeRooms(data as FreeRoom[]);
        setEvents([]);
        setActiveLectures([]);
        if (typeof window !== "undefined" && window.innerWidth < 720) setCollapsed(true);
        return;
      }

      const key = `${Number(year)}-${semester}`;
      let all: AnyLecture[] | undefined = semesterCacheRef.current.get(key);

      if (!all) {
        const url = `/api/snutt/search?year=${encodeURIComponent(
          Number(year)
        )}&semester=${encodeURIComponent(semester)}`;
        const res = await fetch(url);
        const data: unknown = await res.json();
        if (!res.ok || !Array.isArray(data)) {
          setEvents([]);
          setActiveLectures([]);
          setFreeRooms([]);
          alert((data as { error?: string })?.error || "불러오기 실패");
          return;
        }
        all = data as AnyLecture[];
        semesterCacheRef.current.set(key, all);
      }

      if (mode === "professor") {
        const filteredByName = all.filter((lec) => lectureMatchesProfessorExact(lec, q));
        setProfFiltered(filteredByName);
        setFreeRooms([]);
        setEvents([]);
        setActiveLectures([]);
        return;
      }

      const filtered = all.filter((lec) => lectureMatchesRoomExact(lec, q));
      const evts = buildEventsFromLectures(filtered, {
        showBy: mode,
        query: q.trim(),
      }) as EventBlock[];
      setFreeRooms([]);
      setEvents(evts);
      setActiveLectures(filtered);
      if (typeof window !== "undefined" && window.innerWidth < 720) setCollapsed(true);
    } catch {
      setFreeRooms([]);
      setEvents([]);
      setActiveLectures([]);
      alert("불러오기 실패");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== "professor") return;

    if (!profFiltered.length) {
      setDeptOptions([]);
      setDeptInclude(null);
      setEvents([]);
      setActiveLectures([]);
      return;
    }

    const ls = lastSearchRef.current;
    if (
      !ls ||
      ls.mode !== "professor" ||
      ls.q !== q.trim() ||
      ls.year !== year ||
      ls.semester !== semester
    ) {
      return;
    }

    const rawOpts = Array.from(
      new Set(
        profFiltered.map((lec) => String(extractDept(lec) || "").trim()).filter((v) => v.length > 0)
      )
    );

    const grouped = groupDepts(rawOpts);

    if (grouped.mode === "collapsed") {
      const includeArr = Array.from(grouped.include);
      setDeptOptions([grouped.label]);
      setDept(grouped.label);
      setDeptInclude(includeArr);
      const filteredByGroup = profFiltered.filter((lec) =>
        includeArr.includes(String(extractDept(lec)).trim())
      );
      const evts = buildEventsFromLectures(filteredByGroup, {
        showBy: "professor",
        query: q.trim(),
      }) as EventBlock[];
      setFreeRooms([]);
      setEvents(evts);
      setActiveLectures(filteredByGroup);
      if (typeof window !== "undefined" && window.innerWidth < 720 && autoCollapseRef.current) {
        setCollapsed(true);
        autoCollapseRef.current = 0;
      }
      return;
    }

    setDeptOptions(grouped.options);
    setDeptInclude(null);

    if (!dept || !grouped.options.includes(dept)) {
      setEvents([]);
      setActiveLectures([]);
      return;
    }

    const filteredByDept = profFiltered.filter((lec) => String(extractDept(lec)).trim() === dept);

    const evts = buildEventsFromLectures(filteredByDept, {
      showBy: "professor",
      query: q.trim(),
    }) as EventBlock[];

    setFreeRooms([]);
    setEvents(evts);
    setActiveLectures(filteredByDept);
  }, [mode, profFiltered, dept, q, year, semester]);

  const onKeyDownInput: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter" && canSearch && !loading) onSearch();
  };

  const copyRoom = async (room: string) => {
    try {
      await navigator.clipboard.writeText(room);
      setCopied(room);
      setTimeout(() => setCopied(""), 1500);
    } catch {}
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const openDetail = (ev: EventBlock) => {
    let lec: AnyLecture | undefined;

    if (activeLectures?.length) {
      lec =
        activeLectures.find((L: any) => {
          const prof = String(L?.instructor || L?.professor || "").trim();
          const title = String(L?.title || L?.course_title || L?.name || "").trim();
          const sameProf =
            !ev.professor || prof.includes(ev.professor) || ev.professor.includes(prof);
          const sameTitle = !ev.title || title.includes(ev.title) || ev.title.includes(title);
          return sameTitle && sameProf && lectureHasTime(L, ev);
        }) || activeLectures.find((L: any) => lectureHasTime(L, ev));
    }

    setSel({ ev, lec });
  };

  return (
    <div className="tt-wrap">
      <header className="tt-header">
        <div className="tt-headRow">
          <h1 className="tt-title">TTuns</h1>
          <button
            type="button"
            className="tt-collapseBtn"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-controls="tt-filter-panel"
            title={collapsed ? "필터 펼치기" : "필터 접기"}
          >
            <svg
              className="tt-chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 15 12 9 18 15"></polyline>
            </svg>
            <span className="sr-only">{collapsed ? "필터 펼치기" : "필터 접기"}</span>
          </button>
        </div>

        <div className="tt-controls" data-collapsed={collapsed ? "1" : "0"}>
          <div className="tt-pillbar" aria-hidden={!collapsed}>
            <span className="tt-pill">
              {year} • {semesterLabel}
            </span>
            <span className="tt-pill">{modeLabel}</span>
            <span className="tt-pill tt-pill-q" title={q}>
              {q || "검색어 없음"}
            </span>
            {mode === "professor" && dept && <span className="tt-pill">{dept}</span>}
            <button type="button" className="tt-pillbtn" onClick={() => setCollapsed(false)}>
              수정
            </button>
          </div>

          <div
            id="tt-filter-panel"
            ref={panelRef}
            className={`tt-panel ${collapsed ? "collapsed" : ""}`}
            style={{ ["--panel-max-h" as any]: `${panelMaxH}px` }}
          >
            <div className="tt-row">
              <div className="tt-field tt-year">
                <label>연도</label>
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="예: 2025"
                  inputMode="numeric"
                  onKeyDown={onKeyDownInput}
                />
              </div>

              <div className="tt-field tt-sem">
                <label>학기</label>
                <select value={semester} onChange={(e) => setSemester(e.target.value)}>
                  <option value="1">1학기</option>
                  <option value="2">여름학기</option>
                  <option value="3">2학기</option>
                  <option value="4">겨울학기</option>
                </select>
              </div>

              <div className="tt-field tt-grow">
                <label>
                  {mode === "professor" ? "교수명" : mode === "room" ? "강의실" : "건물 동번호"}
                </label>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={
                    mode === "professor"
                      ? "예: 문송기"
                      : mode === "room"
                        ? "예: 26-B101"
                        : "예: 301"
                  }
                  inputMode={mode === "free" ? "numeric" : "text"}
                  onKeyDown={onKeyDownInput}
                />
              </div>

              <div className="tt-field tt-mode">
                <label>검색 유형</label>
                <div className="tt-segment" role="tablist" aria-label="검색 유형 선택">
                  <button
                    type="button"
                    className={`tt-segbtn ${mode === "professor" ? "on" : ""}`}
                    aria-pressed={mode === "professor"}
                    onClick={() => {
                      setMode("professor");
                      setFreeRooms([]);
                      setCollapsed(false);
                    }}
                  >
                    교수명
                  </button>
                  <button
                    type="button"
                    className={`tt-segbtn ${mode === "room" ? "on" : ""}`}
                    aria-pressed={mode === "room"}
                    onClick={() => {
                      setMode("room");
                      setFreeRooms([]);
                      setCollapsed(false);
                    }}
                  >
                    강의실
                  </button>
                  <button
                    type="button"
                    className={`tt-segbtn ${mode === "free" ? "on" : ""}`}
                    aria-pressed={mode === "free"}
                    onClick={() => {
                      setMode("free");
                      setEvents([]);
                      setActiveLectures([]);
                      setCollapsed(false);
                    }}
                  >
                    빈 강의실
                  </button>
                </div>
              </div>

              <button className="tt-primary" onClick={onSearch} disabled={!canSearch || loading}>
                {loading ? "불러오는 중…" : "검색"}
              </button>

              {mode === "professor" && deptOptions.length > 1 && (
                <div className="tt-field tt-dept">
                  <label>소속</label>
                  <select
                    value={dept}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDept(v);
                      if (v) setCollapsed(true);
                    }}
                  >
                    <option value="" disabled>
                      소속 선택
                    </option>
                    {deptOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <div className="tt-deptHint">
                    동명이인이 있습니다. 소속을 선택하면 시간표가 표시됩니다.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {mode === "free" && !loading && (
        <div className="tt-freeWrap">
          <div className="tt-freeHead">
            <div className="tt-freeTitle">현재 빈 강의실</div>
            <div className="tt-freeMeta">기준 시각(KST): {nowKst().hhmm}</div>
          </div>

          {freeRooms.length === 0 ? (
            <div className="tt-empty">결과가 없습니다. 동번호/학기를 확인해 주세요.</div>
          ) : (
            <div className="tt-freeList">
              {freeRooms.map(({ room, until }) => (
                <button key={room} className="tt-roomBtn" onClick={() => copyRoom(room)}>
                  <span className="tt-roomName">{room}</span>
                  <span className="tt-until">~ {fmtHHMM(until)}</span>
                  <span className="tt-copy">{copied === room ? "복사됨" : "복사"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode !== "free" && !loading && events.length === 0 && (
        <div className="tt-empty">
          {mode === "professor" && profFiltered.length > 0 && deptOptions.length > 1 && !dept
            ? "소속을 선택해 주세요."
            : "결과가 없습니다. 입력값과 학기를 확인해 주세요."}
        </div>
      )}

      {mode !== "free" && (
        <div className="tt-tableWrap">
          <div className="tt-grid tt-headerRow">
            <div className="tt-timeCol tt-headCell" aria-hidden="true" />
            {VISIBLE_DAYS.map((d) => (
              <div key={d} className="tt-dayHead tt-headCell">
                {DAY_LABELS[d]}
              </div>
            ))}
          </div>

          <div
            className="tt-grid tt-body"
            style={{ height: Math.max(380, (endMin - startMin) * PPM) }}
          >
            <div className="tt-timeCol">
              {Array.from({ length: Math.floor(endMin / 60) - Math.floor(startMin / 60) + 1 }).map(
                (_, idx) => {
                  const m = (Math.floor(startMin / 60) + idx) * 60;
                  const top = (m - startMin) * PPM;
                  const hour = Math.floor(m / 60);
                  return (
                    <div key={m} className="tt-hourMark" style={{ top }}>
                      <div className="tt-label" data-hour={hour}>
                        {hour}
                      </div>
                      <div className="tt-line" />
                    </div>
                  );
                }
              )}
            </div>

            {VISIBLE_DAYS.map((d) => {
              const list = (laid[d] ?? []) as EventBlock[];
              return (
                <div key={d} className="tt-dayCol">
                  {Array.from({
                    length: Math.floor(endMin / 60) - Math.floor(startMin / 60) + 1,
                  }).map((_, idx) => {
                    const m = (Math.floor(startMin / 60) + idx) * 60;
                    const top = (m - startMin) * PPM;
                    return <div key={m} className="tt-hLine" style={{ top }} />;
                  })}
                  {list.map((e, i) => {
                    const top = (e.start - startMin) * PPM;
                    const height = Math.max(22, (e.end - e.start) * PPM - 2);
                    const widthPct = 100 / e.colCount;
                    const leftPct = widthPct * e.col;
                    const { fill, stroke } = colorForTitle(e.title || "");
                    return (
                      <div
                        key={`${i}-${e.title}-${e.start}`}
                        className="tt-event"
                        title={`${e.title}\n${
                          mode === "professor" ? e.room : e.professor
                        }\n${fmtTime(e.start)}–${fmtTime(e.end)}`}
                        style={{
                          top,
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          height,
                          background: fill,
                          borderColor: stroke,
                        }}
                        onClick={() => openDetail(e)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(k) => k.key === "Enter" && openDetail(e)}
                      >
                        <div className="tt-evTitle">{e.title}</div>
                        <div className="tt-evMeta">
                          {mode === "professor" ? e.room : e.professor}
                        </div>
                        <div className="tt-evTime">
                          {fmtTime(e.start)}–{fmtTime(e.end)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sel && (
        <div className="tt-modal" onClick={() => setSel(null)} role="dialog" aria-modal="true">
          <div className="tt-modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modalHead">
              <div className="tt-modalTitle">{sel.ev.title}</div>
              <button className="tt-x" onClick={() => setSel(null)} aria-label="닫기">
                ×
              </button>
            </div>
            <div className="tt-modalBody">
              <div>
                <b>시간</b> {fmtTime(sel.ev.start)}–{fmtTime(sel.ev.end)} ({DAY_LABELS[sel.ev.day]})
              </div>
              <div>
                <b>{mode === "professor" ? "강의실" : "교수"}</b>{" "}
                {mode === "professor" ? sel.ev.room : sel.ev.professor}
              </div>
              {sel.lec && (
                <>
                  {extractDept(sel.lec) && (
                    <div>
                      <b>소속</b> {extractDept(sel.lec)}
                    </div>
                  )}
                  {sel.lec?.credit != null && (
                    <div>
                      <b>학점</b> {String((sel.lec as any).credit)}
                    </div>
                  )}
                  {sel.lec?.classification && (
                    <div>
                      <b>구분</b> {String((sel.lec as any).classification)}
                    </div>
                  )}
                  {(sel.lec as any)?.course_number && (
                    <div>
                      <b>학수번호</b> {String((sel.lec as any).course_number)}
                    </div>
                  )}
                  {(sel.lec as any)?.lecture_number && (
                    <div>
                      <b>분반</b> {String((sel.lec as any).lecture_number)}
                    </div>
                  )}
                  {(sel.lec as any)?.remark && (
                    <div>
                      <b>비고</b> {String((sel.lec as any).remark)}
                    </div>
                  )}
                  {Array.isArray((sel.lec as any).class_time_json) && (
                    <div>
                      <b>전체 일정</b>
                      <ul>
                        {((sel.lec as any).class_time_json as any[]).map((t, idx) => (
                          <li key={idx}>
                            {DAY_LABELS[Number(t?.day ?? -1)]} {String(t?.place ?? "")}{" "}
                            {fmtTime(Number(t?.startMinute ?? t?.start ?? 0))}–
                            {fmtTime(Number(t?.endMinute ?? t?.end ?? 0))}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {!sel.lec && <div className="tt-empty">소속이 여러 곳인 교수가 있을 수 있어요.</div>}
            </div>
            <div className="tt-modalFoot">
              <button className="tt-primary" onClick={() => setSel(null)}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
