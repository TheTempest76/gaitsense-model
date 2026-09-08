"use client";

import { useState, type ReactNode } from "react";
import { ChartTooltip, HIDDEN_TOOLTIP, type TooltipState } from "./ChartTooltip";
import { useContainerWidth } from "./useContainerWidth";
import { CHART_PAD } from "@/lib/chart-utils";

const HEIGHT = 220;

interface Band {
  lo: number;
  hi: number;
  label?: string;
}

/**
 * Generic line chart: crosshair + nearest-point tooltip, a break in the line
 * across gaps (never interpolated — a straight line through a missing day
 * would invent a measurement), markers only when the series is short enough
 * that they wouldn't merge, and the latest value direct-labeled.
 */
export function LineChart<T extends { v: number | null }>({
  points,
  yMin,
  yMax,
  fmtTick,
  bands,
  xLabel,
  tipContent,
  alt = false,
  emptyMsg,
  ariaLabel,
}: {
  points: T[];
  yMin: number;
  yMax: number;
  fmtTick: (v: number) => string;
  bands?: Band[];
  xLabel: (p: T, i: number) => string;
  tipContent: (p: T) => ReactNode;
  alt?: boolean;
  emptyMsg: string;
  ariaLabel: string;
}) {
  const { ref, width } = useContainerWidth<HTMLDivElement>(320);
  const [tip, setTip] = useState<TooltipState>(HIDDEN_TOOLTIP);
  const [crosshairX, setCrosshairX] = useState<number | null>(null);

  const plotW = width - CHART_PAD.left - CHART_PAD.right;
  const plotH = HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const span = Math.max(1e-9, yMax - yMin);

  const xAt = (i: number) =>
    points.length === 1
      ? CHART_PAD.left + plotW / 2
      : CHART_PAD.left + (i / Math.max(1, points.length - 1)) * plotW;
  const yAt = (v: number) => CHART_PAD.top + plotH - ((v - yMin) / span) * plotH;

  const defined = points.map((p, i) => ({ ...p, i })).filter((p) => p.v !== null) as (T & {
    i: number;
    v: number;
  })[];

  if (!points.length || !defined.length) {
    return (
      <div className="flex h-[120px] items-center justify-center text-[13px] text-ink-muted">
        {emptyMsg}
      </div>
    );
  }

  let d = "";
  let prevIdx: number | null = null;
  for (const p of defined) {
    const cmd = prevIdx === null || p.i !== prevIdx + 1 ? "M" : "L";
    d += `${cmd}${xAt(p.i).toFixed(2)},${yAt(p.v).toFixed(2)}`;
    prevIdx = p.i;
  }

  const yTicks = [0, 1, 2, 3, 4].map((i) => yMin + (span * i) / 4);
  const xLabelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const last = defined[defined.length - 1];
  const stroke = alt ? "var(--series-3)" : "var(--series-1)";

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = defined[0];
    let bestDist = Infinity;
    for (const p of defined) {
      const dist = Math.abs(xAt(p.i) - px);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    setTip({ visible: true, x: px, y: e.clientY - box.top, content: tipContent(best) });
    setCrosshairX(xAt(best.i));
  }

  return (
    <div ref={ref} className="relative no-x-overflow">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={ariaLabel}
        className="block w-full"
      >
        {bands?.map((b, i) => {
          const top = yAt(b.hi);
          const bottom = yAt(b.lo);
          return (
            <g key={i}>
              <rect
                x={CHART_PAD.left}
                y={top}
                width={plotW}
                height={Math.max(0, bottom - top)}
                fill="var(--band-wash)"
              />
              <line
                x1={CHART_PAD.left}
                x2={CHART_PAD.left + plotW}
                y1={top}
                y2={top}
                stroke="var(--band-edge)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              {b.label && (
                <text x={CHART_PAD.left + 6} y={top + 13} className="fill-ink-muted text-[10.5px]">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {yTicks.map((v, i) => {
          const y = yAt(v);
          return (
            <g key={i}>
              <line
                x1={CHART_PAD.left}
                x2={CHART_PAD.left + plotW}
                y1={y}
                y2={y}
                stroke={i === 0 ? "var(--baseline)" : "var(--gridline)"}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={CHART_PAD.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-ink-muted text-[11px] tabular-nums"
              >
                {fmtTick(v)}
              </text>
            </g>
          );
        })}

        <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {defined.length <= 40 &&
          defined.map((p) => (
            <circle
              key={p.i}
              cx={xAt(p.i)}
              cy={yAt(p.v)}
              r={4}
              fill={stroke}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          ))}

        <text
          x={CHART_PAD.left + plotW}
          y={yAt(last.v) - 10}
          textAnchor="end"
          className="fill-ink-muted text-[11px] tabular-nums"
        >
          {fmtTick(last.v)}
        </text>

        {xLabelIdx.map((i) => (
          <text
            key={i}
            x={xAt(i)}
            y={CHART_PAD.top + plotH + 16}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            className="fill-ink-muted text-[11px] tabular-nums"
          >
            {xLabel(points[i], i)}
          </text>
        ))}

        {crosshairX !== null && tip.visible && (
          <line
            x1={crosshairX}
            x2={crosshairX}
            y1={CHART_PAD.top}
            y2={CHART_PAD.top + plotH}
            stroke="var(--baseline)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        )}

        <rect
          x={CHART_PAD.left}
          y={CHART_PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={() => setTip(HIDDEN_TOOLTIP)}
        />
      </svg>
      <ChartTooltip state={tip} containerWidth={width} />
    </div>
  );
}
