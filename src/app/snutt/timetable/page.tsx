"use client";

import { useMemo, useState, useEffect } from "react";
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

type Mode = "professor" | "room";
const VISIBLE_DAYS: DayIndex[] = [0, 1, 2, 3, 4, 5]; // 월~토

function colorForTitle(title: string) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  return { fill: `hsla(${h}, 85%, 96%, 1)`, stroke: `hsl(${h}, 70%, 42%)` };
}
function fmtTime(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

export default function TimetablePage() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [semester, setSemester] = useState("1");  // 1=1학기, 2=여름, 3=2학기, 4=겨울
  const [mode, setMode] = useState<Mode>("room");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<any[]>([]);

  // 반응형 높이(모바일 자동 스케일)
  const [PPM, setPPM] = useState(1.15);
  const laid = layoutByDay(events);
  const { startMin, endMin } = timeBounds(events);

  useEffect(() => {
    const update = () => {
      const isMobile = window.innerWidth < 720;
      if (!isMobile) { setPPM(1.15); return; }
      const range = Math.max(endMin - startMin, 12 * 60);
      const target = Math.max(360, Math.min(520, window.innerHeight * 0.66));
      const ppm = Math.max(0.7, Math.min(1.15, target / range));
      setPPM(ppm);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [startMin, endMin]);

  const canSearch = useMemo(
    () => !!year && !!semester && q.trim().length > 0,
    [year, semester, q]
  );

  const onSearch = async () => {
    if (!canSearch) return;
    setLoading(true);
    try {
      const url = `/api/snutt/search?year=${encodeURIComponent(Number(year))}&semester=${encodeURIComponent(semester)}`;
      const res = await fetch(url, { method: "GET" });
      const data = await res.json();

      if (!res.ok) { setEvents([]); alert(data?.error || "불러오기 실패"); return; }

      const all: AnyLecture[] = Array.isArray(data) ? data : [];
      const filtered = all.filter((lec) =>
        mode === "professor" ? lectureMatchesProfessorExact(lec, q) : lectureMatchesRoomExact(lec, q)
      );

      const evts = buildEventsFromLectures(filtered, { showBy: mode, query: q.trim() });
      setEvents(evts);
    } catch {
      setEvents([]); alert("불러오기 실패");
    } finally {
      setLoading(false);
    }
  };

  const totalHeight = Math.max(400, (endMin - startMin) * PPM);

  // 정시 눈금
  const hourMarks: number[] = [];
  for (let m = Math.floor(startMin/60)*60; m <= Math.ceil(endMin/60)*60; m += 60) hourMarks.push(m);

  return (
    <div className="tt-wrap">
      <header className="tt-header">
        <h1 className="tt-title">교수/강의실 시간표</h1>

        <div className="tt-controls">
          <div className="tt-row">
            <div className="tt-field tt-year">
              <label>연도</label>
              <input value={year} onChange={(e)=>setYear(e.target.value)} placeholder="예: 2025" />
            </div>

            <div className="tt-field tt-sem">
              <label>학기</label>
              <select value={semester} onChange={(e)=>setSemester(e.target.value)}>
                <option value="1">1학기</option>
                <option value="2">여름학기</option>
                <option value="3">2학기</option>
                <option value="4">겨울학기</option>
              </select>
            </div>

            <div className="tt-field tt-grow">
              <label>{mode === "professor" ? "교수명" : "강의실"}</label>
              <input
                value={q}
                onChange={(e)=>setQ(e.target.value)}
                placeholder={mode === "professor" ? "예: 문송기" : "예: 26-B101"}
              />
            </div>

            <div className="tt-field">
              <label>검색 유형</label>
              <div className="tt-segment" role="tablist" aria-label="검색 유형 선택">
                <button
                  type="button"
                  className={`tt-segbtn ${mode === "professor" ? "on" : ""}`}
                  aria-pressed={mode === "professor"}
                  onClick={()=>setMode("professor")}
                >
                  교수명
                </button>
                <button
                  type="button"
                  className={`tt-segbtn ${mode === "room" ? "on" : ""}`}
                  aria-pressed={mode === "room"}
                  onClick={()=>setMode("room")}
                >
                  강의실
                </button>
              </div>
            </div>

            <button className="tt-primary" onClick={onSearch} disabled={!canSearch || loading}>
              {loading ? "불러오는 중…" : "검색"}
            </button>
          </div>
        </div>
      </header>

      {!loading && events.length === 0 && (
        <div className="tt-empty">결과가 없습니다. 입력값과 학기를 확인해 주세요.</div>
      )}

      {/* 시간표 */}
      <div className="tt-tableWrap">
        {/* 헤더: 왼쪽 ‘시간’ 텍스트 제거 */}
        <div className="tt-grid tt-headerRow">
          <div className="tt-timeCol tt-headCell" aria-hidden="true"></div>
          {VISIBLE_DAYS.map((d) => (
            <div key={d} className="tt-dayHead tt-headCell">{DAY_LABELS[d]}</div>
          ))}
        </div>

        {/* 본문 */}
        <div className="tt-grid tt-body" style={{ height: totalHeight }}>
          {/* 시간 축 */}
          <div className="tt-timeCol">
            {hourMarks.map((m) => {
              const top = (m - startMin) * PPM;
              const hour = Math.floor(m/60); // "08:00" → "8"
              return (
                <div key={m} className="tt-hourMark" style={{ top }}>
                  <div className="tt-label">{hour}</div>
                  <div className="tt-line" />
                </div>
              );
            })}
          </div>

          {/* 월~토만 */}
          {VISIBLE_DAYS.map((d) => {
            const list = laid[d] ?? [];
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
                      key={i}
                      className="tt-event"
                      title={`${e.title}\n${mode === "professor" ? e.room : e.professor}\n${fmtTime(e.start)}–${fmtTime(e.end)}`}
                      style={{ top, left: `${leftPct}%`, width: `${widthPct}%`, height, background: fill, borderColor: stroke }}
                    >
                      <div className="tt-evTitle">{e.title}</div>
                      <div className="tt-evMeta">{mode === "professor" ? e.room : e.professor}</div>
                      <div className="tt-evTime">{fmtTime(e.start)}–{fmtTime(e.end)}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
