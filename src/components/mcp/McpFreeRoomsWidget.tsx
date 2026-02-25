"use client";

import { useEffect, useMemo, useState } from "react";
import NearbyRadar from "@/components/ttuns/NearbyRadar";
import { useWidgetToolOutput } from "@/components/mcp/useWidgetToolOutput";
import {
  FreeRoom,
  NearbyBuildingPoint,
  fmtDistance,
  fmtTime,
  isFreeRoom,
  isNearbyBuildingPoint,
} from "@/lib/ttunsUi";

type ToolOutput = {
  year?: number | string;
  semester?: number | string;
  building?: string;
  free_room_count?: number;
  free_rooms?: unknown[];
  lat?: number;
  lon?: number;
  format?: "buildings" | "rooms";
  count?: number;
  items?: unknown[];
};

export default function McpFreeRoomsWidget() {
  const toolOutput = useWidgetToolOutput<ToolOutput>();
  const [selectedNearbyBuilding, setSelectedNearbyBuilding] = useState("");

  const mode = useMemo<"waiting" | "free" | "nearby">(() => {
    if (!toolOutput) return "waiting";
    if (typeof toolOutput.lat === "number" && typeof toolOutput.lon === "number") return "nearby";
    return "free";
  }, [toolOutput]);

  const freeRooms = useMemo(() => {
    const rows = toolOutput?.free_rooms;
    if (!Array.isArray(rows)) return [] as FreeRoom[];
    return rows.filter(isFreeRoom);
  }, [toolOutput]);

  const nearbyItems = useMemo(() => {
    const rows = toolOutput?.items;
    if (!Array.isArray(rows)) return [] as unknown[];
    return rows;
  }, [toolOutput]);

  const nearbyBuildings = useMemo(() => {
    return nearbyItems.filter(isNearbyBuildingPoint);
  }, [nearbyItems]);

  const hasRadar = nearbyItems.length > 0 && nearbyBuildings.length === nearbyItems.length;

  useEffect(() => {
    if (!hasRadar) {
      setSelectedNearbyBuilding("");
      return;
    }
    if (nearbyBuildings.some((item) => item.building === selectedNearbyBuilding)) return;
    setSelectedNearbyBuilding(nearbyBuildings[0]?.building ?? "");
  }, [hasRadar, nearbyBuildings, selectedNearbyBuilding]);

  const selectedNearby = useMemo(() => {
    if (!hasRadar) return null;
    return (
      nearbyBuildings.find((building) => building.building === selectedNearbyBuilding) ||
      nearbyBuildings[0] ||
      null
    );
  }, [hasRadar, nearbyBuildings, selectedNearbyBuilding]);

  const roomsToRender = mode === "nearby" ? selectedNearby?.rooms || [] : freeRooms;

  const year = String(toolOutput?.year ?? "-");
  const semester = String(toolOutput?.semester ?? "-");
  const summary = useMemo(() => {
    if (!toolOutput) return "ChatGPT가 전달한 결과를 기다리는 중입니다.";

    if (mode === "nearby") {
      const count = typeof toolOutput.count === "number" ? toolOutput.count : nearbyItems.length;
      return `내 주변 검색 결과 ${count}건 (${year}년 ${semester}학기)`;
    }

    const building = String(toolOutput.building ?? "-");
    const count =
      typeof toolOutput.free_room_count === "number"
        ? toolOutput.free_room_count
        : freeRooms.length;
    return `${building}동 빈 강의실 결과 ${count}건 (${year}년 ${semester}학기)`;
  }, [freeRooms.length, mode, nearbyItems.length, semester, toolOutput, year]);

  return (
    <main className="tt-wrap">
      <div className="tt-freeWrap">
        <div className="tt-freeHead">
          <div>
            <div className="tt-freeTitle">TTuns 빈 강의실 결과</div>
            <div className="tt-freeMeta">데이터 제공: ChatGPT</div>
            <div className="tt-freeMeta">{summary}</div>
          </div>
        </div>

        {mode === "waiting" && <div className="tt-empty">표시할 결과가 아직 없습니다.</div>}

        {mode === "nearby" && hasRadar && (
          <div className="tt-freeRadarSection">
            <NearbyRadar
              buildings={nearbyBuildings as NearbyBuildingPoint[]}
              selectedBuilding={selectedNearbyBuilding}
              onSelectBuilding={setSelectedNearbyBuilding}
            />
          </div>
        )}

        {mode === "nearby" && !hasRadar && nearbyItems.length > 0 && (
          <div
            className="tt-nearbyList"
            style={{ gridTemplateColumns: "repeat(1, minmax(0, 1fr))" }}
          >
            {nearbyItems.map((item, index) => (
              <pre key={`nearby-json-${index}`} style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {JSON.stringify(item, null, 2)}
              </pre>
            ))}
          </div>
        )}

        {roomsToRender.length === 0 ? (
          mode !== "waiting" && (
            <div className="tt-empty">
              {mode === "nearby"
                ? "주변에서 현재 빈 강의실이 있는 동을 찾지 못했어요."
                : "결과가 없습니다."}
            </div>
          )
        ) : (
          <>
            {mode === "nearby" && selectedNearby && (
              <div className="tt-freeSubhead">
                {selectedNearby.building}동 기준 현재 빈 강의실 ·{" "}
                {fmtDistance(selectedNearby.distanceMeters)} · {selectedNearby.freeRoomCount}개
              </div>
            )}
            <div className="tt-freeList">
              {roomsToRender.map(({ room, until }) => (
                <div key={`${room}-${until}`} className="tt-roomBtn" role="group" aria-label={room}>
                  <span className="tt-roomName">{room}</span>
                  <span className="tt-until">~ {fmtTime(until)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
