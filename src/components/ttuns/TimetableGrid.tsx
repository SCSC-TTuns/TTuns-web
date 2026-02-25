"use client";

import { ReactNode } from "react";
import { DAY_LABELS, layoutByDay, timeBounds, type DayIndex } from "@/lib/lectureSchedule";
import { EventBlock, TimetableRenderMode, fmtTime } from "@/lib/ttunsUi";

type TimetableGridProps = {
  events: EventBlock[];
  mode: TimetableRenderMode;
  ppm: number;
  onEventClick?: (event: EventBlock) => void;
  emptyState?: ReactNode;
};

function colorForTitle(title: string) {
  let hue = 0;
  for (let i = 0; i < title.length; i++) hue = (hue * 31 + title.charCodeAt(i)) % 360;
  const smax = 65;
  const smin = 40;
  const saturation =
    hue < 120
      ? (smax * (120 - hue) + smin * hue) / 120
      : (smax * (hue - 120) + smin * (240 - hue)) / 120;
  const lmax = 59;
  const lmin = 40;
  const lightness =
    hue < 120
      ? (lmax * (120 - hue) + lmin * hue) / 120
      : (lmax * (hue - 120) + lmin * (240 - hue)) / 120;
  return {
    fill: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
    stroke: `hsla(${hue}, 85%, 96%, 1)`,
  };
}

export default function TimetableGrid({
  events,
  mode,
  ppm,
  onEventClick,
  emptyState,
}: TimetableGridProps) {
  const laid = layoutByDay(events);
  const visibleDays: DayIndex[] = (laid[5] ?? []).length > 0 ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];
  const { startMin, endMin } = timeBounds(events);

  return (
    <>
      {events.length === 0 && emptyState ? emptyState : null}
      <div className="tt-tableWrap">
        <div
          className="tt-grid tt-headerRow"
          no-saturday={((laid[5] ?? []).length === 0).toString()}
        >
          <div className="tt-timeCol tt-headCell" aria-hidden="true" />
          {visibleDays.map((d) => (
            <div key={d} className="tt-dayHead tt-headCell">
              {DAY_LABELS[d]}
            </div>
          ))}
        </div>

        <div
          className="tt-grid tt-body"
          no-saturday={((laid[5] ?? []).length === 0).toString()}
          style={{ height: Math.max(380, (endMin - startMin) * ppm) }}
        >
          <div className="tt-timeCol">
            {Array.from({ length: Math.floor(endMin / 60) - Math.floor(startMin / 60) + 1 }).map(
              (_, idx) => {
                const minute = (Math.floor(startMin / 60) + idx) * 60;
                const top = (minute - startMin) * ppm;
                const hour = Math.floor(minute / 60);
                return (
                  <div key={minute} className="tt-hourMark" style={{ top }}>
                    <div className="tt-label" data-hour={hour}>
                      {hour}
                    </div>
                    <div className="tt-line" />
                  </div>
                );
              }
            )}
          </div>

          {visibleDays.map((d) => {
            const list = laid[d] ?? [];
            return (
              <div key={d} className="tt-dayCol">
                {Array.from({
                  length: Math.floor(endMin / 60) - Math.floor(startMin / 60) + 1,
                }).map((_, idx) => {
                  const minute = (Math.floor(startMin / 60) + idx) * 60;
                  const top = (minute - startMin) * ppm;
                  return <div key={minute} className="tt-hLine" style={{ top }} />;
                })}
                {list.map((event, idx) => {
                  const top = (event.start - startMin) * ppm;
                  const height = Math.max(22, (event.end - event.start) * ppm - 2);
                  const overlaps = list.filter(
                    (other) => other !== event && other.start < event.end && other.end > event.start
                  );
                  const activeCols = Array.from(
                    new Set([...overlaps.map((other) => other.col), event.col])
                  ).sort((a, b) => a - b);
                  const localColCount = Math.max(1, activeCols.length);
                  const localIndex = Math.max(0, activeCols.indexOf(event.col));
                  const widthPct = 100 / localColCount;
                  const leftPct = widthPct * localIndex;
                  const { fill, stroke } = colorForTitle(event.title || "");
                  const clickable = typeof onEventClick === "function";

                  return (
                    <div
                      key={`${idx}-${event.title}-${event.start}`}
                      className="tt-event"
                      title={`${event.title}\n${
                        mode === "professor" ? event.room : event.professor
                      }\n${fmtTime(event.start)}–${fmtTime(event.end)}`}
                      style={{
                        top,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        height,
                        background: fill,
                        borderColor: stroke,
                      }}
                      onClick={clickable ? () => onEventClick(event) : undefined}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onKeyDown={
                        clickable
                          ? (keyboardEvent) => {
                              if (keyboardEvent.key === "Enter") onEventClick(event);
                            }
                          : undefined
                      }
                    >
                      <div className="tt-evTitle">{event.title}</div>
                      <div className="tt-evMeta">
                        {mode === "professor" ? event.room : event.professor}
                      </div>
                      <div className="tt-evTime">
                        {fmtTime(event.start)}–{fmtTime(event.end)}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
