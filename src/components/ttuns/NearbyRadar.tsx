"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { NearbyBuildingPoint, PlotNode, fmtDistance, pointInRect } from "@/lib/ttunsUi";

type NearbyRadarProps = {
  buildings: NearbyBuildingPoint[];
  selectedBuilding: string;
  onSelectBuilding: (building: string) => void;
  scaleLabel?: string;
};

export default function NearbyRadar({
  buildings,
  selectedBuilding,
  onSelectBuilding,
  scaleLabel,
}: NearbyRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const plotRef = useRef<PlotNode[]>([]);
  const [computedScaleMeters, setComputedScaleMeters] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const drawRoundRectPath = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) => {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + w - rr, y);
      ctx.arcTo(x + w, y, x + w, y + rr, rr);
      ctx.lineTo(x + w, y + h - rr);
      ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
      ctx.lineTo(x + rr, y + h);
      ctx.arcTo(x, y + h, x, y + h - rr, rr);
      ctx.lineTo(x, y + rr);
      ctx.arcTo(x, y, x + rr, y, rr);
      ctx.closePath();
    };

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(280, Math.round(rect.width));
      const height = Math.max(260, Math.round(rect.height));
      const dprRaw = window.devicePixelRatio || 1;
      const dpr = Math.min(Math.max(dprRaw, 1), 2);
      const realW = Math.max(1, Math.round(width * dpr));
      const realH = Math.max(1, Math.round(height * dpr));

      if (canvas.width !== realW || canvas.height !== realH) {
        canvas.width = realW;
        canvas.height = realH;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const root = getComputedStyle(document.documentElement);
      const line = (root.getPropertyValue("--line") || "#d1d5db").trim();
      const lineSoft = (root.getPropertyValue("--line-soft") || "#eef2f7").trim();
      const primary = (root.getPropertyValue("--primary") || "#4f46e5").trim();
      const primary2 = (root.getPropertyValue("--primary-2") || "#6366f1").trim();
      const panel = (root.getPropertyValue("--panel") || "#ffffff").trim();
      const mutedForeground = (root.getPropertyValue("--muted-foreground") || "#6b7280").trim();
      const isDark = document.documentElement.classList.contains("dark");
      const radialCardinalStroke = line;
      const radialMinorStroke = lineSoft;
      const ringMajorStroke = line;
      const ringMinorStroke = lineSoft;
      const radarBoundaryStroke = line;
      const labelStroke = isDark ? mutedForeground : line;

      ctx.fillStyle = panel;
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const centerX = Math.round(cx) + 0.5;
      const centerY = Math.round(cy) + 0.5;
      const RADAR_CELL_METERS = 50;
      const padding = 12;
      const minHalf = Math.min(width, height) / 2;
      const maxCells = Math.max(3, Math.floor((minHalf - padding) / 20));
      const rawCellPx = Math.max(12, Math.min(22, (minHalf - padding) / maxCells));
      const cellPx = Math.max(12, Math.min(22, Math.round(rawCellPx * 2) / 2));
      const ringRadiusAt = (index: number) => Math.max(0.5, Math.round(index * cellPx) + 0.5);
      const radarRadius = ringRadiusAt(maxCells);
      const viewMeters = maxCells * RADAR_CELL_METERS;

      // Polar-only radar body.
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radarRadius, 0, Math.PI * 2);
      ctx.clip();

      // Keep radar tone identical with nearby panel.
      ctx.fillStyle = panel;
      ctx.fillRect(
        Math.round(centerX - radarRadius),
        Math.round(centerY - radarRadius),
        Math.round(radarRadius * 2),
        Math.round(radarRadius * 2)
      );

      const radialCount = 12;

      // Polar grid: alternate sector tint to improve cell separation at a glance.
      const sectorFill = lineSoft;
      const sectorAlpha = isDark ? 0.44 : 0.6;
      for (let i = 0; i < radialCount; i += 2) {
        const start = (i * Math.PI * 2) / radialCount;
        const end = ((i + 1) * Math.PI * 2) / radialCount;
        ctx.save();
        ctx.globalAlpha = sectorAlpha;
        ctx.fillStyle = sectorFill;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radarRadius, start, end);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Polar grid: alternating ring bands to make each 50m cell separation clearer.
      const ringBandFill = lineSoft;
      const ringBandAlpha = isDark ? 0.5 : 0.42;
      for (let i = 1; i <= maxCells; i += 2) {
        ctx.save();
        ctx.globalAlpha = ringBandAlpha;
        ctx.fillStyle = ringBandFill;
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadiusAt(i), 0, Math.PI * 2);
        ctx.arc(centerX, centerY, ringRadiusAt(i - 1), 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Polar grid: 12 radial lines (30-degree step), cardinal emphasized.
      const radialCardinalAlpha = isDark ? 0.9 : 0.88;
      const radialMinorAlpha = isDark ? 0.64 : 0.58;
      for (let i = 0; i < radialCount; i++) {
        const angle = (i * Math.PI * 2) / radialCount;
        const cardinal = i % 3 === 0;
        const endX = Math.round(centerX + Math.cos(angle) * radarRadius) + 0.5;
        const endY = Math.round(centerY + Math.sin(angle) * radarRadius) + 0.5;
        ctx.save();
        ctx.globalAlpha = cardinal ? radialCardinalAlpha : radialMinorAlpha;
        ctx.strokeStyle = cardinal ? radialCardinalStroke : radialMinorStroke;
        ctx.lineWidth = cardinal ? 1.35 : 1.05;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.restore();
      }

      // Polar grid: rings every 50m, emphasized every 250m.
      const ringMajorAlpha = isDark ? 0.92 : 0.88;
      const ringMinorAlpha = isDark ? 0.7 : 0.62;
      for (let i = 1; i <= maxCells; i++) {
        const major = i % 5 === 0;
        ctx.save();
        ctx.globalAlpha = major ? ringMajorAlpha : ringMinorAlpha;
        ctx.strokeStyle = major ? ringMajorStroke : ringMinorStroke;
        ctx.lineWidth = major ? 1.35 : 1.05;
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadiusAt(i), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // Radar boundary
      ctx.save();
      ctx.globalAlpha = isDark ? 0.96 : 0.92;
      ctx.strokeStyle = radarBoundaryStroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radarRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = isDark ? 0.92 : 0.86;
      ctx.fillStyle = primary2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = panel;
      ctx.stroke();
      ctx.restore();

      plotRef.current = [];

      if (!buildings.length) {
        setComputedScaleMeters((prev) => (prev === 0 ? prev : 0));
        return;
      }

      const labelPaddingX = 6;
      const labelPaddingY = 3;
      const labelHeight = 11 + labelPaddingY * 2;
      const bodyFont = getComputedStyle(document.body).fontFamily;
      ctx.font = `11px ${bodyFont || '"Pretendard Variable", sans-serif'}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      setComputedScaleMeters((prev) => (prev === viewMeters ? prev : viewMeters));
      const plotItems: PlotNode[] = buildings
        .map((item) => {
          const gx = item.dxMeters / RADAR_CELL_METERS;
          const gy = item.dyMeters / RADAR_CELL_METERS;
          if (Math.hypot(gx, gy) > maxCells) return null;
          const x = cx + gx * cellPx;
          const y = cy - gy * cellPx;
          const textWidth = Math.ceil(ctx.measureText(item.building).width);
          const labelWidth = Math.max(18, textWidth + labelPaddingX * 2);
          return {
            building: item.building,
            item,
            x,
            y,
            labelRect: {
              x: x - labelWidth / 2,
              y: y - labelHeight / 2,
              w: labelWidth,
              h: labelHeight,
            },
          };
        })
        .filter((value): value is PlotNode => value !== null);

      if (!plotItems.length) return;

      const labelDrawOrder = [...plotItems].sort((a, b) => {
        const aSelected = a.building === selectedBuilding ? 1 : 0;
        const bSelected = b.building === selectedBuilding ? 1 : 0;
        if (aSelected !== bSelected) return aSelected - bSelected;
        if (a.item.distanceMeters !== b.item.distanceMeters) {
          return b.item.distanceMeters - a.item.distanceMeters;
        }
        return a.building.localeCompare(b.building);
      });

      for (const node of labelDrawOrder) {
        const isSelected = node.building === selectedBuilding;
        ctx.save();
        drawRoundRectPath(
          ctx,
          node.labelRect.x,
          node.labelRect.y,
          node.labelRect.w,
          node.labelRect.h,
          4
        );
        ctx.fillStyle = isSelected ? primary : panel;
        ctx.fill();
        ctx.globalAlpha = isSelected ? 1 : isDark ? 0.45 : 1;
        ctx.strokeStyle = isSelected ? primary : labelStroke;
        ctx.lineWidth = isSelected ? 1.4 : 1;
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = isSelected ? panel : primary;
        ctx.fillText(node.building, Math.round(node.x), Math.round(node.y));
      }

      plotRef.current = labelDrawOrder;
    };

    let rafId = 0;
    const scheduleDraw = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        draw();
      });
    };

    draw();

    let observer: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => scheduleDraw());
      observer.observe(canvas);
    }
    if (typeof MutationObserver !== "undefined") {
      themeObserver = new MutationObserver(() => scheduleDraw());
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    window.addEventListener("resize", scheduleDraw);

    return () => {
      observer?.disconnect();
      themeObserver?.disconnect();
      window.removeEventListener("resize", scheduleDraw);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [buildings, selectedBuilding]);

  const onCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!plotRef.current.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    for (let i = plotRef.current.length - 1; i >= 0; i--) {
      const plot = plotRef.current[i];
      if (pointInRect(x, y, plot.labelRect)) {
        onSelectBuilding(plot.building);
        return;
      }
    }
  };

  const resolvedScaleLabel =
    scaleLabel ||
    (computedScaleMeters > 0 ? `한 칸 50m · 반경 ±${fmtDistance(computedScaleMeters)}` : "");

  return (
    <>
      <div className="tt-nearbyCanvasBox">
        <canvas
          ref={canvasRef}
          className="tt-nearbyCanvas"
          onClick={onCanvasClick}
          role="img"
          aria-label="내 주변 빈 강의실 건물 레이더"
        />
        {resolvedScaleLabel ? <div className="tt-nearbyScale">{resolvedScaleLabel}</div> : null}
      </div>

      {!!buildings.length && (
        <div className="tt-nearbyList">
          {buildings.slice(0, 8).map((building) => (
            <button
              key={building.building}
              type="button"
              className={clsx("tt-nearbyChip", selectedBuilding === building.building && "on")}
              onClick={() => onSelectBuilding(building.building)}
            >
              <span className="tt-nearbyChipTitle">{building.building}</span>
              <span className="tt-nearbyChipMeta">
                {fmtDistance(building.distanceMeters)} · {building.freeRoomCount}개
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
