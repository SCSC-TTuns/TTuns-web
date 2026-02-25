"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { DayIndex } from "@/lib/lectureSchedule";
import {
  AnyLecture,
  buildEventsFromLectures,
  DAY_LABELS,
  lectureMatchesProfessorExact,
  lectureMatchesRoomExact,
  timeBounds,
} from "@/lib/lectureSchedule";
import TrackedButton from "@/components/TrackedButton";
import { trackEvent, trackUIEvent } from "@/lib/mixpanel/trackEvent";
import ReactDOM from "react-dom";
import { clsx } from "clsx";
import { Label } from "@/components/ui/label";
import { DarkModeToggle } from "@/components/DarkModeToggle";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import TimetableGrid from "@/components/ttuns/TimetableGrid";
import NearbyRadar from "@/components/ttuns/NearbyRadar";
import { EventBlock, FreeRoom, NearbyBuildingPoint, fmtDistance, fmtTime } from "@/lib/ttunsUi";

type Mode = "professor" | "room" | "free";
type GeoPoint = { lat: number; lon: number };
type ResolvedGeoPosition = GeoPoint & { source: "gps" | "cached" };

function parseModeParam(value: string | null): Mode | null {
  if (value === "professor" || value === "room" || value === "free") return value;
  return null;
}

function fmtHHMM(min: number) {
  return fmtTime(min);
}

const LAST_GEO_KEY = "ttuns.lastGeo.v1";

function readCachedGeo(): GeoPoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_GEO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: unknown; lon?: unknown };
    const lat = Number(parsed?.lat);
    const lon = Number(parsed?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

function writeCachedGeo(pos: GeoPoint) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_GEO_KEY, JSON.stringify(pos));
  } catch {}
}

function geoErrorMessage(err: unknown): string {
  const geo = err as { code?: number; message?: string };
  if (geo?.code === 1) return "위치 권한이 필요해요. 브라우저에서 위치 접근을 허용해 주세요.";
  if (geo?.code === 2) return "현재 위치를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.";
  if (geo?.code === 3) return "위치 확인 시간이 초과됐어요. 다시 시도해 주세요.";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "위치 기반 검색은 HTTPS 환경에서만 사용할 수 있어요.";
  }
  return "내 위치를 가져오지 못했어요. 동번호를 입력하거나 잠시 후 다시 시도해 주세요.";
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

function currentYearSemesterKst(): { year: string; semester: string } {
  // KST 기준 날짜(연/월/일) 추출
  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = kst.getFullYear();
  const m = kst.getMonth() + 1; // 1~12
  const d = kst.getDate(); // 1~31

  // 규칙:
  // n년 12/25 ~ n+1년 1/31 => n년 겨울학기(4)
  // n년 2/1 ~ 6/18 => n년 1학기(1)
  // n년 6/19 ~ 8/5 => n년 여름학기(2)
  // 나머지 => n년 2학기(3)

  // 1월(1/1~1/31)은 "전년도 겨울학기"
  if (m === 1) return { year: String(y - 1), semester: "4" };

  // 12월 25일~31일은 "당해 겨울학기"
  if (m === 12 && d >= 25) return { year: String(y), semester: "4" };

  // 2/1~6/18: 1학기
  if (m >= 2 && (m < 6 || (m === 6 && d <= 18))) return { year: String(y), semester: "1" };

  // 6/19~8/5: 여름학기
  if ((m === 6 && d >= 19) || m === 7 || (m === 8 && d <= 5)) {
    return { year: String(y), semester: "2" };
  }

  // 나머지: 2학기
  return { year: String(y), semester: "3" };
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
  const baseKey = (s: string) =>
    s.replace(/\(.*$/u, "").replace(/\s+/g, "").replace(/학과$/u, "").replace(/과$/u, "").trim();

  const detailedBases = new Set<string>();
  for (const d of list) {
    if (d.includes("(")) detailedBases.add(baseKey(d));
  }

  const filteredForDetail = list.filter((d) => {
    const hasParen = d.includes("(");
    if (hasParen) return true;
    const bk = baseKey(d);
    return !detailedBases.has(bk);
  });

  const joint = filteredForDetail.filter((d) => JOINT_RE.test(d));
  const base = filteredForDetail.filter((d) => !JOINT_RE.test(d));

  if (filteredForDetail.length === 0) return { mode: "dropdown" as const, options: [] as string[] };

  if (base.length === 1) {
    const label = base[0];
    const include = new Set<string>([label, ...joint]);
    return { mode: "collapsed" as const, label, include };
  }

  return { mode: "dropdown" as const, options: filteredForDetail };
}

const chosungList = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
function getChosung(ch: string): string {
  if (!ch) return "";
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return chosungList[Math.floor((code - 0xac00) / 588)] || ch;
  }
  return ch;
}

function isFuzzyMatch(input: string, target: string): boolean {
  const normalizedInput = input.toLowerCase().replace(/\s/g, "");
  const normalizedTarget = target.toLowerCase().replace(/\s/g, "");

  let input_point = 0; // input ("홍ㄱㄷ") 포인터
  let target_point = 0; // target ("홍길동") 포인터

  while (input_point < normalizedInput.length && target_point < normalizedTarget.length) {
    const inputChar = normalizedInput[input_point];
    const targetSyllable = normalizedTarget[target_point];

    if (inputChar === targetSyllable || inputChar === getChosung(targetSyllable)) {
      input_point++;
      target_point++;
    } else {
      target_point++;
    }
  }

  return input_point === normalizedInput.length;
}

function TimetablePageContent() {
  const searchParams = useSearchParams();
  const initialYS = useMemo(() => currentYearSemesterKst(), []);
  const initialParamState = useMemo(() => {
    const yearParam = String(searchParams.get("year") ?? "").trim();
    const semesterParam = String(searchParams.get("semester") ?? "").trim();
    const modeParam = parseModeParam(searchParams.get("mode"));
    const queryParam = String(searchParams.get("q") ?? "");
    const safeYear = /^\d{4}$/.test(yearParam) ? yearParam : initialYS.year;
    const safeSemester = ["1", "2", "3", "4"].includes(semesterParam)
      ? semesterParam
      : initialYS.semester;
    return {
      year: safeYear,
      semester: safeSemester,
      mode: modeParam ?? "room",
      q: queryParam,
    };
  }, [initialYS.semester, initialYS.year, searchParams]);

  const [year, setYear] = useState(initialParamState.year);
  const [semester, setSemester] = useState(initialParamState.semester);

  const [mode, setMode] = useState<Mode>(initialParamState.mode);
  const [q, setQ] = useState(initialParamState.q);
  const [loading, setLoading] = useState(false);

  const [events, setEvents] = useState<EventBlock[]>([]);
  const [freeRooms, setFreeRooms] = useState<FreeRoom[]>([]);
  const [copied, setCopied] = useState<string>("");
  const [nearbyBuildings, setNearbyBuildings] = useState<NearbyBuildingPoint[]>([]);
  const [nearbyError, setNearbyError] = useState("");
  const [selectedNearbyBuilding, setSelectedNearbyBuilding] = useState<string>("");
  const [userPos, setUserPos] = useState<ResolvedGeoPosition | null>(null);

  const [collapsed, setCollapsed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelMaxH, setPanelMaxH] = useState<number>(520);

  const [deptOptions, setDeptOptions] = useState<string[]>([]);
  const [dept, setDept] = useState<string>("");
  const [profFiltered, setProfFiltered] = useState<AnyLecture[]>([]);

  const [activeLectures, setActiveLectures] = useState<AnyLecture[]>([]);
  const [sel, setSel] = useState<{ ev: EventBlock; lec?: AnyLecture } | null>(null);

  const [PPM, setPPM] = useState(1.1);
  const [historyByMode, setHistoryByMode] = useState<Record<Mode, string[]>>({
    professor: [],
    room: [],
    free: [],
  });
  const { startMin, endMin } = useMemo(() => timeBounds(events), [events]);

  const semesterCacheRef = useRef(new Map<string, AnyLecture[]>());
  const lastSearchRef = useRef<{ q: string; year: string; semester: string; mode: Mode } | null>(
    null
  );
  const autoCollapseRef = useRef<number>(0);
  const viewStartRef = useRef<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const blurTimeout = useRef<number | null>(null);

  useEffect(() => {
    viewStartRef.current = Date.now();

    const onHide = () => {
      if (viewStartRef.current != null) {
        const dur = Date.now() - viewStartRef.current;
        trackEvent("page_duration", { page: "/", duration_ms: dur });
        viewStartRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onHide);

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onHide);
      if (viewStartRef.current != null) {
        const dur = Date.now() - viewStartRef.current;
        trackEvent("page_duration", { page: "/", duration_ms: dur });
        viewStartRef.current = null;
      }
    };
  }, []);

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
  // 뒤로가기(popstate) 시 필터 자동 펼침
  useEffect(() => {
    const onPop = () => setCollapsed(false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 검색어가 비어(초기화)지면 필터 자동 펼침
  useEffect(() => {
    if (!loading && q.trim() === "") setCollapsed(false);
  }, [q, loading]);

  const canSearch = useMemo(
    () => !!year && !!semester && (mode === "free" || q.trim().length > 0),
    [mode, year, semester, q]
  );

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
    setProfFiltered([]);
    setActiveLectures([]);
    setEvents([]);
    setFreeRooms([]);
    setNearbyBuildings([]);
    setNearbyError("");
    setSelectedNearbyBuilding("");
    setSel(null);
  }, [mode, year, semester]);

  const HIST_KEY = "ttuns.searchHistory.v1";
  const loadHistory = (): Record<Mode, string[]> => {
    if (typeof window === "undefined") return { professor: [], room: [], free: [] };
    try {
      const raw = localStorage.getItem(HIST_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<Record<Mode, string[]>>) : {};
      const dedup = (arr: unknown): string[] => {
        if (!Array.isArray(arr)) return [];
        const uniq = Array.from(
          new Set(
            arr.map((v) => (typeof v === "string" ? v.trim() : "")).filter((s): s is string => !!s)
          )
        );
        return uniq.slice(0, 3);
      };
      return {
        professor: dedup(parsed.professor),
        room: dedup(parsed.room),
        free: dedup(parsed.free),
      };
    } catch {
      return { professor: [], room: [], free: [] };
    }
  };
  const saveHistory = (next: Record<Mode, string[]>) => {
    try {
      if (typeof window !== "undefined") localStorage.setItem(HIST_KEY, JSON.stringify(next));
    } catch {}
  };
  const addHistory = (m: Mode, query: string) => {
    const t = query.trim();
    if (!t) return;
    setHistoryByMode((prev) => {
      const cur = prev[m] || [];
      const tl = t.toLowerCase();
      const filtered = [t, ...cur.filter((x) => String(x).trim().toLowerCase() !== tl)].slice(0, 3);
      const next = { ...prev, [m]: filtered } as Record<Mode, string[]>;
      saveHistory(next);
      return next;
    });
  };
  const removeHistory = (m: Mode, query: string) => {
    const t = query.trim();
    if (!t) return;
    setHistoryByMode((prev) => {
      const cur = prev[m] || [];
      const nextList = cur.filter((x) => String(x).trim() !== t);
      const next = { ...prev, [m]: nextList } as Record<Mode, string[]>;
      saveHistory(next);
      return next;
    });
  };
  useEffect(() => {
    setHistoryByMode(loadHistory());
  }, []);

  //reset app to initial state
  const resetToInitial = () => {
    setQ("");
    setEvents([]);
    setFreeRooms([]);
    setActiveLectures([]);
    setProfFiltered([]);
    setDeptOptions([]);
    setDept("");
    setSel(null);
    //reset other if needed
  };

  //reset state when go back button is pressed
  useEffect(() => {
    const handlePopState = () => {
      resetToInitial();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const onSearch = async (overrideQ?: string | unknown) => {
    const query = (typeof overrideQ === "string" ? overrideQ : q).trim();
    const can = !!year && !!semester && (mode === "free" || query.length > 0);
    if (!can) return;

    setInputFocused(false);
    if (inputRef.current) inputRef.current.blur();
    setSuggestions([]);

    setLoading(true);
    setCopied("");
    setDept("");
    setDeptOptions([]);
    setProfFiltered([]);
    lastSearchRef.current = { q: query, year, semester, mode };
    autoCollapseRef.current = Date.now();

    try {
      if (mode === "free") {
        const k = nowKst();
        const isNearbyMode = query.length === 0;

        if (isNearbyMode) {
          let pos: ResolvedGeoPosition;
          try {
            pos = userPos ?? (await requestCurrentPosition());
          } catch (err) {
            const msg = geoErrorMessage(err);
            setFreeRooms([]);
            setNearbyError(msg);
            trackEvent("search_failed", {
              search_type: mode,
              year,
              semester,
              query: "__nearby__",
              reason: "geolocation_error",
            });
            return;
          }

          setUserPos(pos);
          const points = await loadNearbyAirdrop(pos);
          const nearest = points[0] ?? null;
          setSelectedNearbyBuilding(nearest?.building ?? "");
          setFreeRooms(nearest?.rooms ?? []);
          setEvents([]);
          setActiveLectures([]);
          if (!nearest) {
            setNearbyError("주변에서 빈 강의실이 있는 동을 찾지 못했어요.");
          } else {
            setNearbyError("");
          }
          trackEvent("search_performed", {
            search_type: mode,
            year,
            semester,
            query: "__nearby__",
            query_len: 0,
            result_count: nearest?.rooms.length ?? 0,
          });
          if (typeof window !== "undefined" && window.innerWidth < 720) setCollapsed(true);
          return;
        }

        const url = `/api/snutt/free-rooms?year=${encodeURIComponent(
          Number(year)
        )}&semester=${encodeURIComponent(semester)}&building=${encodeURIComponent(query)}&day=${
          k.snuttDay
        }&at=${k.hhmm}`;
        const res = await fetch(url);
        const data: unknown = await res.json();

        if (!res.ok || !Array.isArray(data)) {
          setFreeRooms([]);
          trackEvent("search_failed", {
            search_type: mode,
            year,
            semester,
            query: q.trim(),
          });
          alert((data as { error?: string })?.error || "불러오기 실패");
          return;
        }
        setFreeRooms(data as FreeRoom[]);
        addHistory("free", query);
        setEvents([]);
        setActiveLectures([]);
        setNearbyError("");
        trackEvent("search_performed", {
          search_type: mode,
          year,
          semester,
          query: q.trim(),
          query_len: q.trim().length,
          result_count: Array.isArray(data) ? data.length : 0,
        });
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
          trackEvent("search_failed", {
            search_type: mode,
            year,
            semester,
            query: q.trim(),
          });
          alert((data as { error?: string })?.error || "불러오기 실패");
          return;
        }
        all = data as AnyLecture[];
        semesterCacheRef.current.set(key, all);
      }

      if (mode === "professor") {
        const filteredByName = all.filter((lec) => lectureMatchesProfessorExact(lec, query));
        setProfFiltered(filteredByName);
        addHistory("professor", query);
        setFreeRooms([]);
        setEvents([]);
        setActiveLectures([]);
        trackEvent("search_performed", {
          search_type: mode,
          year,
          semester,
          query: q.trim(),
          query_len: q.trim().length,
          result_count: filteredByName.length,
        });
        return;
      }

      const filtered = all.filter((lec) => lectureMatchesRoomExact(lec, query));
      const evts = buildEventsFromLectures(filtered, {
        showBy: mode,
        query,
      }) as EventBlock[];
      setFreeRooms([]);
      setEvents(evts);
      setActiveLectures(filtered);
      trackEvent("search_performed", {
        search_type: mode,
        year,
        semester,
        query: q.trim(),
        query_len: q.trim().length,
        result_count: evts.length,
      });
      addHistory("room", query);
      if (typeof window !== "undefined" && window.innerWidth < 720) setCollapsed(true);
    } catch {
      setFreeRooms([]);
      setEvents([]);
      setActiveLectures([]);
      trackEvent("search_failed", {
        search_type: mode,
        year,
        semester,
        query: q.trim(),
      });
      alert("불러오기 실패");
    } finally {
      setLoading(false);
      window.history.pushState(null, ""); //to stay on the app
    }
  };

  useEffect(() => {
    if (mode !== "professor") return;

    if (!profFiltered.length) {
      setDeptOptions([]);
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

    if (!dept || !grouped.options.includes(dept)) {
      setEvents([]);
      setActiveLectures([]);
      return;
    }

    const filteredByDept = profFiltered.filter((lec) =>
      String(extractDept(lec)).trim().includes(dept)
    );

    const evts = buildEventsFromLectures(filteredByDept, {
      showBy: "professor",
      query: q.trim(),
    }) as EventBlock[];

    setFreeRooms([]);
    setEvents(evts);
    setActiveLectures(filteredByDept);
  }, [mode, profFiltered, dept, q, year, semester]);

  const onKeyDownInput: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter" && canSearch && !loading) {
      trackUIEvent.buttonClick("timetable_search");
      onSearch();
    }
  };

  const copyRoom = async (room: string) => {
    try {
      await navigator.clipboard.writeText(room);
      setCopied(room);
      trackEvent("room_copied", { room_prefix: room.split("-")[0] || "", label_len: room.length });
      setTimeout(() => setCopied(""), 1500);
    } catch {}
  };

  const selectedNearby = useMemo(
    () =>
      nearbyBuildings.find((b) => b.building === selectedNearbyBuilding) ??
      nearbyBuildings[0] ??
      null,
    [nearbyBuildings, selectedNearbyBuilding]
  );

  useEffect(() => {
    if (mode !== "free") return;
    if (q.trim().length !== 0) return;
    setFreeRooms(selectedNearby?.rooms ?? []);
  }, [mode, q, selectedNearby]);

  const requestCurrentPosition = () =>
    new Promise<ResolvedGeoPosition>((resolve, reject) => {
      const cached = readCachedGeo();
      if (typeof navigator === "undefined") {
        if (cached) {
          resolve({ ...cached, source: "cached" });
          return;
        }
        reject(new Error("navigator unavailable"));
        return;
      }
      if (!navigator.geolocation) {
        if (cached) {
          resolve({ ...cached, source: "cached" });
          return;
        }
        reject(new Error("geolocation unsupported"));
        return;
      }
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            writeCachedGeo(next);
            resolve({ ...next, source: "gps" });
          },
          (err) => {
            if (cached) {
              resolve({ ...cached, source: "cached" });
              return;
            }
            reject(err);
          },
          { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
        );
      } catch (err) {
        if (cached) {
          resolve({ ...cached, source: "cached" });
          return;
        }
        reject(err);
      }
    });

  const loadNearbyAirdrop = async (preset?: ResolvedGeoPosition) => {
    setNearbyError("");

    try {
      const pos = preset ?? (await requestCurrentPosition());
      setUserPos(pos);

      const url = `/api/snutt/recommendation/location?year=${encodeURIComponent(
        Number(year)
      )}&semester=${encodeURIComponent(semester)}&lat=${encodeURIComponent(
        pos.lat
      )}&lon=${encodeURIComponent(pos.lon)}&limit=24&radiusMeters=600&format=buildings`;
      const res = await fetch(url);
      const data: unknown = await res.json();

      if (!res.ok || !Array.isArray(data)) {
        setNearbyBuildings([]);
        setSelectedNearbyBuilding("");
        setNearbyError((data as { error?: string })?.error || "내 주변 정보를 불러오지 못했어요.");
        return [] as NearbyBuildingPoint[];
      }

      const parsed = (data as unknown[])
        .map((item) => {
          const row = item as Partial<NearbyBuildingPoint>;
          if (
            typeof row?.building !== "string" ||
            typeof row?.buildingName !== "string" ||
            typeof row?.lat !== "number" ||
            typeof row?.lon !== "number" ||
            typeof row?.distanceMeters !== "number" ||
            typeof row?.dxMeters !== "number" ||
            typeof row?.dyMeters !== "number" ||
            typeof row?.freeRoomCount !== "number" ||
            typeof row?.topUntil !== "number" ||
            !Array.isArray(row?.rooms)
          ) {
            return null;
          }
          const rooms = row.rooms
            .filter(
              (r): r is FreeRoom =>
                !!r &&
                typeof (r as FreeRoom).room === "string" &&
                typeof (r as FreeRoom).until === "number"
            )
            .slice(0, 6);
          return { ...row, rooms } as NearbyBuildingPoint;
        })
        .filter((row): row is NearbyBuildingPoint => row !== null);

      setNearbyBuildings(parsed);
      setSelectedNearbyBuilding(parsed[0]?.building ?? "");
      trackEvent("nearby_airdrop_loaded", {
        count: parsed.length,
        year,
        semester,
      });
      return parsed;
    } catch (err) {
      const geo = err as { message?: string };
      const msg = geoErrorMessage(err);
      setNearbyBuildings([]);
      setSelectedNearbyBuilding("");
      setNearbyError(msg);
      trackEvent("nearby_airdrop_failed", { reason: geo?.message || "unknown" });
      return [] as NearbyBuildingPoint[];
    }
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
    trackEvent("event_detail_opened", {
      by: mode,
      title_len: (ev.title || "").length,
      day: ev.day,
      start: ev.start,
      end: ev.end,
    });
  };

  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!q.trim() || loading) {
      setSuggestions([]);
      return;
    }
    const key = `${Number(year)}-${semester}`;
    const all = semesterCacheRef.current.get(key);
    if (!all) {
      setSuggestions([]);
      return;
    }
    let list: string[] = [];
    const input = q.trim();
    if (mode === "professor") {
      const professors = Array.from(
        new Set(
          all
            .map((lec) => String(lec?.instructor || lec?.professor || "").trim())
            .filter((v) => v.length > 0 && isFuzzyMatch(input, v))
        )
      );
      list = professors.sort((a, b) => {
        const aPrefix = a.startsWith(input);
        const bPrefix = b.startsWith(input);
        if (aPrefix && !bPrefix) return -1;
        if (!aPrefix && bPrefix) return 1;
        return a.localeCompare(b);
      });
    } else if (mode === "room") {
      let matcher: (room: string) => boolean;
      if (!input.includes("-")) {
        matcher = (room: string) => room.startsWith(input + "-");
      } else {
        const building = input.split("-")[0];
        matcher = (room: string) => room.startsWith(building + "-") && room.includes(input);
      }
      list = Array.from(
        new Set(
          all
            .map((lec) =>
              Array.isArray(lec?.class_time_json)
                ? lec.class_time_json.map((t: any) => String(t?.place ?? t?.room ?? "").trim())
                : []
            )
            .flat()
            .filter((v) => v.length > 0 && matcher(v))
        )
      );
      list = list.sort((a, b) => {
        const aPrefix = a.startsWith(input) ? -1 : 1;
        const bPrefix = b.startsWith(input) ? -1 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        return a.localeCompare(b);
      });
    } else if (mode === "free") {
      const buildings = Array.from(
        new Set(
          all
            .map((lec) =>
              Array.isArray(lec?.class_time_json)
                ? lec.class_time_json.map((t: any) => {
                    const room = String(t?.place ?? t?.room ?? "").trim();
                    return room.split("-")[0];
                  })
                : []
            )
            .flat()
            .filter((v) => v.length > 0 && v.includes(input))
        )
      );
      list = buildings.sort((a, b) => {
        const aPrefix = a.startsWith(input);
        const bPrefix = b.startsWith(input);
        if (aPrefix && !bPrefix) return -1;
        if (!aPrefix && bPrefix) return 1;
        return a.localeCompare(b);
      });
    }
    setSuggestions(list);
  }, [q, mode, year, semester, loading]);

  useEffect(() => {
    const key = `${Number(year)}-${semester}`;
    if (semesterCacheRef.current.has(key)) return;
    const url = `/api/snutt/search?year=${encodeURIComponent(
      Number(year)
    )}&semester=${encodeURIComponent(semester)}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          semesterCacheRef.current.set(key, data);
        }
      })
      .catch(() => {});
  }, [year, semester]);

  const handleSuggestionSelect = (value: string) => {
    setQ(value);
    setInputFocused(false);
    if (inputRef.current) inputRef.current.blur();
    setSuggestions([]);
    onSearch(value);
  };

  return (
    <main className={clsx("tt-wrap")}>
      <Card className="tt-header p-4">
        <div className="tt-headRow p-2">
          <h1 className="tt-title text-2xl">TTuns</h1>
          <div className="tt-buttons absolute right-3 flex gap-2">
            <DarkModeToggle />
            <TrackedButton
              button_type="toggle_filter_collapse"
              className="tt-collapseBtn"
              aria-expanded={!collapsed}
              aria-controls="tt-filter-panel"
              onClick={() => setCollapsed((v) => !v)}
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
            </TrackedButton>
          </div>
        </div>

        <div className="tt-controls" data-collapsed={collapsed ? "1" : "0"}>
          <div className="tt-pillbar" aria-hidden={!collapsed}>
            <span className="tt-pill">
              {year}년 {semesterLabel}
            </span>
            <span className="tt-pill">{modeLabel}</span>
            <span className="tt-pill tt-pill-q" title={q}>
              {q || "검색어 없음"}
            </span>
            {mode === "professor" && dept && <span className="tt-pill">{dept}</span>}
            <TrackedButton
              button_type="pill_edit_filters"
              className="tt-pillbtn"
              onClick={() => setCollapsed(false)}
            >
              수정
            </TrackedButton>
          </div>

          <div
            id="tt-filter-panel"
            ref={panelRef}
            className={`tt-panel ${collapsed ? "collapsed" : ""}`}
            style={{ ["--panel-max-h" as any]: `${panelMaxH}px` }}
          >
            <div className="tt-row">
              <div className="tt-field tt-year">
                <Label>연도</Label>
                <Input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="예: 2025"
                  inputMode="numeric"
                  onKeyDown={onKeyDownInput}
                />
              </div>

              <div className="tt-field tt-sem">
                <Label>학기</Label>
                <Select value={semester} onValueChange={(value) => setSemester(value)}>
                  <SelectTrigger className="w-[100%]">
                    <SelectValue placeholder="학기" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1학기</SelectItem>
                    <SelectItem value="2">여름학기</SelectItem>
                    <SelectItem value="3">2학기</SelectItem>
                    <SelectItem value="4">겨울학기</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="tt-field tt-mode">
                <Label>
                  {mode === "professor" ? "교수명" : mode === "room" ? "강의실" : "건물 동번호"}
                </Label>
                <div className="tt-searchWrap">
                  <Input
                    ref={inputRef}
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
                    autoComplete="off"
                    onFocus={() => {
                      if (blurTimeout.current) {
                        clearTimeout(blurTimeout.current);
                        blurTimeout.current = null;
                      }
                      setInputFocused(true);
                    }}
                    onBlur={() => {
                      blurTimeout.current = window.setTimeout(() => {
                        setInputFocused(false);
                      }, 150);
                    }}
                  />
                  {suggestions.length > 0 &&
                    inputFocused &&
                    inputRef.current &&
                    ReactDOM.createPortal(
                      <div
                        className="tt-suggestList"
                        style={{
                          position: "absolute",
                          left: inputRef.current.getBoundingClientRect().left,
                          top: inputRef.current.getBoundingClientRect().bottom + window.scrollY,
                          width: inputRef.current.offsetWidth,
                          zIndex: 9999,
                        }}
                      >
                        {suggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="tt-suggestItem"
                            onClick={() => handleSuggestionSelect(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>,
                      document.body
                    )}
                  <div className="tt-history" aria-label="최근 검색">
                    {(historyByMode[mode] || []).slice(0, 3).map((h) => (
                      <div key={h} className="tt-hChip">
                        <button
                          key={h}
                          type="button"
                          className="tt-hChip-text"
                          title={`최근 검색: ${h}`}
                          onClick={() => {
                            setQ(h);
                            setInputFocused(false);
                            if (inputRef.current) inputRef.current.blur();
                            setSuggestions([]);
                            if (!loading) onSearch(h);
                          }}
                        >
                          {h}
                        </button>

                        <button
                          type="button"
                          className="tt-hChip-delete"
                          aria-label={`최근 검색 ${h} 삭제`}
                          title="삭제"
                          onClick={() => {
                            removeHistory(mode, h);
                            trackEvent("history_item_deleted", { mode, value_len: h.length });
                          }}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="tt-field tt-mode">
                <Label>검색 유형</Label>
                <div className="tt-segment" role="tablist" aria-label="검색 유형 선택">
                  <TrackedButton
                    button_type="mode_professor"
                    className={clsx("tt-segbtn", mode === "professor" ? "on" : "", "text-xs")}
                    aria-pressed={mode === "professor"}
                    onClick={() => {
                      setMode("professor");
                      setFreeRooms([]);
                      setCollapsed(false);
                      trackEvent("mode_changed", { to: "professor" });
                    }}
                  >
                    교수명
                  </TrackedButton>
                  <TrackedButton
                    button_type="mode_room"
                    className={clsx("tt-segbtn", mode === "room" ? "on" : "", "text-xs")}
                    aria-pressed={mode === "room"}
                    onClick={() => {
                      setMode("room");
                      setFreeRooms([]);
                      setCollapsed(false);
                      trackEvent("mode_changed", { to: "room" });
                    }}
                  >
                    강의실
                  </TrackedButton>
                  <TrackedButton
                    button_type="mode_free"
                    className={clsx("tt-segbtn", mode === "free" ? "on" : "", "text-xs")}
                    aria-pressed={mode === "free"}
                    onClick={() => {
                      setMode("free");
                      setEvents([]);
                      setActiveLectures([]);
                      setCollapsed(false);
                      trackEvent("mode_changed", { to: "free" });
                    }}
                  >
                    빈 강의실
                  </TrackedButton>
                </div>
              </div>

              <TrackedButton
                button_type="timetable_search"
                className="tt-primary"
                onClick={() => onSearch()}
                disabled={!canSearch || loading}
              >
                {loading
                  ? "불러오는 중…"
                  : mode === "free" && q.trim().length === 0
                    ? "내 주변 검색"
                    : "검색"}
              </TrackedButton>

              {mode === "professor" && deptOptions.length > 1 && (
                <div className="tt-field tt-dept">
                  <label>소속</label>
                  <select
                    value={dept}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDept(v);
                      trackEvent("department_selected", { has_value: !!v });
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
      </Card>

      {mode === "free" && !loading && (
        <div className="tt-freeWrap">
          <div className="tt-freeHead">
            <div>
              <div className="tt-freeTitle">현재 빈 강의실</div>
              <div className="tt-freeMeta">
                기준 시각(KST): {nowKst().hhmm}{" "}
                {q.trim().length > 0
                  ? `· ${q.trim()}동`
                  : selectedNearby
                    ? `· 선택 동 ${selectedNearby.building}`
                    : "· 내 주변"}
                {q.trim().length === 0 && userPos?.source === "cached" && (
                  <span className="tt-geoApprox"> · 대략적 위치</span>
                )}
              </div>
            </div>
          </div>

          {q.trim().length === 0 && (
            <div className="tt-freeRadarSection">
              <NearbyRadar
                buildings={nearbyBuildings}
                selectedBuilding={selectedNearbyBuilding}
                onSelectBuilding={setSelectedNearbyBuilding}
              />
              {nearbyError && <div className="tt-nearbyError">{nearbyError}</div>}
            </div>
          )}

          {freeRooms.length === 0 ? (
            <div className="tt-empty">
              {q.trim().length === 0
                ? "주변에서 현재 빈 강의실이 있는 동을 찾지 못했어요."
                : "결과가 없습니다. 동번호와 학기를 확인해 주세요."}
            </div>
          ) : (
            <>
              {q.trim().length === 0 && selectedNearby && (
                <div className="tt-freeSubhead">
                  {selectedNearby.building}동 기준 현재 빈 강의실 ·{" "}
                  {fmtDistance(selectedNearby.distanceMeters)} · {selectedNearby.freeRoomCount}개
                </div>
              )}
              <div className="tt-freeList">
                {freeRooms.map(({ room, until }) => (
                  <TrackedButton
                    key={room}
                    button_type="free_room_copy"
                    className="tt-roomBtn"
                    onClick={() => copyRoom(room)}
                  >
                    <span className="tt-roomName">{room}</span>
                    <span className="tt-until">~ {fmtHHMM(until)}</span>
                    <span className="tt-copy">{copied === room ? "복사됨" : "복사"}</span>
                  </TrackedButton>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {mode !== "free" && !loading && events.length === 0 && (
        <div className="tt-empty">
          {mode === "professor" && profFiltered.length > 0 && deptOptions.length > 1 && !dept
            ? "소속을 선택해 주세요."
            : `결과가 없습니다. ${mode === "professor" ? "교수명" : "강의실"}과 학기를 확인해 주세요.`}
        </div>
      )}

      {mode !== "free" && (
        <TimetableGrid
          events={events}
          mode={mode === "professor" ? "professor" : "room"}
          ppm={PPM}
          onEventClick={openDetail}
        />
      )}

      {sel && (
        <div className="tt-modal" onClick={() => setSel(null)} role="dialog" aria-modal="true">
          <div className="tt-modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modalHead">
              <div className="tt-modalTitle">{sel.ev.title}</div>
              <TrackedButton
                button_type="detail_close_icon"
                className="tt-x"
                aria-label="닫기"
                onClick={() => setSel(null)}
              >
                ×
              </TrackedButton>
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
              <TrackedButton
                button_type="detail_close_button"
                className="tt-primary"
                onClick={() => setSel(null)}
              >
                확인
              </TrackedButton>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function TimetablePage() {
  return (
    <Suspense fallback={null}>
      <TimetablePageContent />
    </Suspense>
  );
}
