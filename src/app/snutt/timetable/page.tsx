"use client";

import { useEffect, useMemo, useState } from "react";
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

/** 화면 모드 */
type Mode = "professor" | "room" | "free";

/** 빈 강의실 API 응답 타입 */
type FreeRoom = { room: string; until: number };

/** 시간표 이벤트(lectureSchedule 유틸이 반환하는 최소 필드) */
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

const VISIBLE_DAYS: DayIndex[] = [0, 1, 2, 3, 4, 5]; // 월~토

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

/** Asia/Seoul 현재 요일/시각 */
function nowKst() {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const jsDay = kst.getDay(); // Sun=0..Sat=6
  const snuttDay = (jsDay === 0 ? 6 : jsDay - 1) as DayIndex; // Mon=0..Sun=6
  const minute = kst.getHours() * 60 + kst.getMinutes();
  const hh = String(kst.getHours()).padStart(2, "0");
  const mm = String(kst.getMinutes()).padStart(2, "0");
  return { snuttDay, minute, hhmm: `${hh}:${mm}` };
}

export default function TimetablePage() {
  /** 기본값: 2025 / 2학기(=3) */
  const [year, setYear] = useState("2025");
  const [semester, setSemester] = useState("3");

  const [mode, setMode] = useState<Mode>("room");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  // 시간표/빈방 상태
  const [events, setEvents] = useState<EventBlock[]>([]);
  const [freeRooms, setFreeRooms] = useState<FreeRoom[]>([]);
  const [copied, setCopied] = useState<string>("");

  // 모바일 자동 높이(zoom 금지)
  const [PPM, setPPM] = useState(1.1);
  const laid = layoutByDay(events);
  const { startMin, endMin } = timeBounds(events);

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

  // 초기 학기 데이터 프리페치(서버/엣지 캐시 예열 → 체감속도↑)
  useEffect(() => {
    const url = `/api/snutt/search?year=${encodeURIComponent(
      Number(year)
    )}&semester=${encodeURIComponent(semester)}`;
    fetch(url).catch(() => {});
  }, [year, semester]);

  const canSearch = useMemo(
    () => !!year && !!semester && q.trim().length > 0,
    [year, semester, q]
  );

  const onSearch = async () => {
    if (!canSearch) return;
    setLoading(true);
    setCopied("");

    try {
      if (mode === "free") {
        // 빈 강의실: 건물 동번호 기준
        const k = nowKst();
        const url = `/api/snutt/free-rooms?year=${encodeURIComponent(
          Number(year)
        )}&semester=${encodeURIComponent(
          semester
        )}&building=${encodeURIComponent(q.trim())}&day=${
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
        return;
      }

      // 교수/강의실 시간표
      const url = `/api/snutt/search?year=${encodeURIComponent(
        Number(year)
      )}&semester=${encodeURIComponent(semester)}`;
      const res = await fetch(url);
      const data: unknown = await res.json();

      if (!res.ok || !Array.isArray(data)) {
        setEvents([]);
        alert((data as { error?: string })?.error || "불러오기 실패");
        return;
      }

      const all = data as AnyLecture[];
      const filtered = all.filter((lec) =>
        mode === "professor"
          ? lectureMatchesProfessorExact(lec, q)
          : lectureMatchesRoomExact(lec, q)
      );
      const evts = buildEventsFromLectures(filtered, {
        showBy: mode,
        query: q.trim(),
      }) as EventBlock[];

      setFreeRooms([]);
      setEvents(evts);
    } catch {
      setFreeRooms([]);
      setEvents([]);
      alert("불러오기 실패");
    } finally {
      setLoading(false);
    }
  };

  const totalHeight = Math.max(380, (endMin - startMin) * PPM);

  // 정시 눈금
  const hourMarks: number[] = [];
  for (
    let m = Math.floor(startMin / 60) * 60;
    m <= Math.ceil(endMin / 60) * 60;
    m += 60
  )
    hourMarks.push(m);

  // 복사
  const copyRoom = async (room: string) => {
    try {
      await navigator.clipboard.writeText(room);
      setCopied(room);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      // ignore
    }
  };

  // Enter로 검색
  const onKeyDownInput: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter" && canSearch && !loading) onSearch();
  };

  return (
    <div className="tt-wrap">
      <header className="tt-header">
        <h1 className="tt-title">TTuns</h1>

        <div className="tt-controls">
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
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
              >
                <option value="1">1학기</option>
                <option value="2">여름학기</option>
                <option value="3">2학기</option>
                <option value="4">겨울학기</option>
              </select>
            </div>

            <div className="tt-field tt-grow">
              <label>
                {mode === "professor"
                  ? "교수명"
                  : mode === "room"
                  ? "강의실"
                  : "건물 동번호"}
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
              <div
                className="tt-segment"
                role="tablist"
                aria-label="검색 유형 선택"
              >
                <button
                  type="button"
                  className={`tt-segbtn ${mode === "professor" ? "on" : ""}`}
                  aria-pressed={mode === "professor"}
                  onClick={() => {
                    setMode("professor");
                    setFreeRooms([]);
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
                  }}
                >
                  빈 강의실
                </button>
              </div>
            </div>

            <button
              className="tt-primary"
              onClick={onSearch}
              disabled={!canSearch || loading}
            >
              {loading ? "불러오는 중…" : "검색"}
            </button>
          </div>
        </div>
      </header>

      {/* 빈 강의실 결과 – 시간표 위 */}
      {mode === "free" && !loading && (
        <div className="tt-freeWrap">
          <div className="tt-freeHead">
            <div className="tt-freeTitle">현재 빈 강의실</div>
            <div className="tt-freeMeta">기준 시각(KST): {nowKst().hhmm}</div>
          </div>

          {freeRooms.length === 0 ? (
            <div className="tt-empty">
              결과가 없습니다. 동번호/학기를 확인해 주세요.
            </div>
          ) : (
            <div className="tt-freeList">
              {freeRooms.map(({ room, until }) => (
                <button
                  key={room}
                  className="tt-roomBtn"
                  onClick={() => copyRoom(room)}
                >
                  <span className="tt-roomName">{room}</span>
                  <span className="tt-until">~ {fmtHHMM(until)}</span>
                  <span className="tt-copy">
                    {copied === room ? "복사됨" : "복사"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 교수/강의실 결과 없음 메시지 */}
      {mode !== "free" && !loading && events.length === 0 && (
        <div className="tt-empty">
          결과가 없습니다. 입력값과 학기를 확인해 주세요.
        </div>
      )}

      {/* 시간표 (빈 강의실 모드에서는 숨김) */}
      {mode !== "free" && (
        <div className="tt-tableWrap">
          {/* 헤더 */}
          <div className="tt-grid tt-headerRow">
            <div className="tt-timeCol tt-headCell" aria-hidden="true" />
            {VISIBLE_DAYS.map((d) => (
              <div key={d} className="tt-dayHead tt-headCell">
                {DAY_LABELS[d]}
              </div>
            ))}
          </div>

          {/* 본문 */}
          <div className="tt-grid tt-body" style={{ height: totalHeight }}>
            {/* 시간축 */}
            <div className="tt-timeCol">
              {hourMarks.map((m) => {
                const top = (m - startMin) * PPM;
                const hour = Math.floor(m / 60); // 8, 9, 10 ...
                return (
                  <div key={m} className="tt-hourMark" style={{ top }}>
                    <div className="tt-label">{hour}</div>
                    <div className="tt-line" />
                  </div>
                );
              })}
            </div>

            {/* 월~토 */}
            {VISIBLE_DAYS.map((d) => {
              const list = (laid[d] ?? []) as EventBlock[];
              return (
                <div key={d} className="tt-dayCol">
                  {hourMarks.map((m) => {
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
    </div>
  );
}
