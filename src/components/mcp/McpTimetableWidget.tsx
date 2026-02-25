"use client";

import { useMemo } from "react";
import TimetableGrid from "@/components/ttuns/TimetableGrid";
import { useWidgetToolOutput } from "@/components/mcp/useWidgetToolOutput";
import { EventBlock, TimetableRenderMode, isEventBlock } from "@/lib/ttunsUi";

type TimetableToolOutput = {
  year?: number | string;
  semester?: number | string;
  query?: string;
  search_type?: TimetableRenderMode;
  event_count?: number;
  events?: unknown[];
};

export default function McpTimetableWidget() {
  const toolOutput = useWidgetToolOutput<TimetableToolOutput>();

  const events = useMemo(() => {
    const rows = toolOutput?.events;
    if (!Array.isArray(rows)) return [] as EventBlock[];
    return rows.filter(isEventBlock);
  }, [toolOutput]);

  const mode = toolOutput?.search_type === "professor" ? "professor" : "room";
  const query = String(toolOutput?.query ?? "").trim();
  const year = String(toolOutput?.year ?? "-");
  const semester = String(toolOutput?.semester ?? "-");
  const eventCount =
    typeof toolOutput?.event_count === "number" ? toolOutput.event_count : events.length;

  const summary = toolOutput
    ? `${mode === "professor" ? "교수명" : "강의실"} ${query ? `\"${query}\" ` : ""}결과 ${eventCount}건 (${year}년 ${semester}학기)`
    : "ChatGPT가 전달한 시간표 결과를 기다리는 중입니다.";

  return (
    <main className="tt-wrap">
      <section className="tt-freeWrap" style={{ marginBottom: 8 }}>
        <div className="tt-freeTitle">TTuns 시간표 결과</div>
        <div className="tt-freeMeta">데이터 제공: ChatGPT</div>
        <div className="tt-freeMeta">{summary}</div>
      </section>
      <TimetableGrid
        events={events}
        mode={mode}
        ppm={1.05}
        emptyState={<div className="tt-empty">표시할 시간표 이벤트가 없습니다.</div>}
      />
    </main>
  );
}
