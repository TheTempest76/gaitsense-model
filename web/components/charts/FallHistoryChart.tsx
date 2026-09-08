"use client";

import { useState } from "react";
import { Card, CardHeading } from "../ui/Card";
import { GhostButton } from "../ui/Pill";
import { DataTable } from "./DataTable";
import { ChartTooltip, HIDDEN_TOOLTIP, type TooltipState } from "./ChartTooltip";
import { useContainerWidth } from "./useContainerWidth";
import { barPath, CHART_PAD, fmtInt, niceMax } from "@/lib/chart-utils";
import { syntheticFallHistory } from "@/lib/fall-history";

const HEIGHT = 200;

/**
 * A different series colour (--series-2, orange) from the other dashboard
 * charts on purpose — Steps uses series-1 (blue), Cadence uses series-3
 * (green); this is a distinct measure and reusing a colour already assigned
 * elsewhere on the page would blur "which chart is this" at a glance. Orange
 * also reads as "worth noting" without the alarm connotation a red would
 * carry, which matters given this whole chart is sample data, not a real
 * detected-falls log — see lib/fall-history.ts.
 */
export function FallHistoryChart() {
  const [showTable, setShowTable] = useState(false);
  const { ref, width } = useContainerWidth<HTMLDivElement>(320);
  const [tip, setTip] = useState<TooltipState>(HIDDEN_TOOLTIP);

  const months = syntheticFallHistory(6);
  const total = months.reduce((sum, m) => sum + m.count, 0);

  const plotW = width - CHART_PAD.left - CHART_PAD.right;
  const plotH = HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const yMax = niceMax(Math.max(1, ...months.map((m) => m.count)));
  const GAP = 10;
  const slot = plotW / months.length;
  const barW = Math.max(4, slot - GAP);

  const yTicks = Array.from({ length: Math.min(4, yMax) + 1 }, (_, i) =>
    Math.round((yMax * i) / Math.min(4, yMax))
  );

  return (
    <Card delay={0.18}>
      <CardHeading
        title="Falls, last 6 months"
        hint="Sample data for demonstration — not a real detected-falls log. This device doesn't detect falls; see the gait pattern indicator above for what it actually measures."
        action={
          <GhostButton pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Chart" : "Table"}
          </GhostButton>
        }
      />

      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[22px] font-semibold tabular-nums leading-none">{total}</span>
        <span className="text-[13px] text-ink-secondary">total over the period shown</span>
      </div>

      {showTable ? (
        <DataTable head={["Month", "Falls"]} rows={months.map((m) => [m.label, fmtInt(m.count)])} />
      ) : (
        <div ref={ref} className="relative no-x-overflow">
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            width={width}
            height={HEIGHT}
            role="img"
            aria-label="Sample monthly fall count for the last 6 months (demonstration data)"
            className="block w-full"
          >
            {yTicks.map((v, i) => {
              const y = CHART_PAD.top + plotH - (v / yMax) * plotH;
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
                    {fmtInt(v)}
                  </text>
                </g>
              );
            })}

            {months.map((m, i) => {
              const h = (m.count / yMax) * plotH;
              const x = CHART_PAD.left + i * slot + (slot - barW) / 2;
              const y = CHART_PAD.top + plotH - h;
              return (
                <g key={m.label}>
                  {h > 0 && <path d={barPath(x, y, barW, h, 4)} fill="var(--series-2)" />}
                  <rect
                    x={CHART_PAD.left + i * slot}
                    y={CHART_PAD.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onMouseMove={(e) => {
                      const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setTip({
                        visible: true,
                        x: e.clientX - box.left,
                        y: e.clientY - box.top,
                        content: (
                          <div>
                            <div className="text-ink-secondary">{m.label}</div>
                            <div>
                              <span className="tabular-nums font-semibold">{fmtInt(m.count)}</span>{" "}
                              {m.count === 1 ? "fall" : "falls"} (sample data)
                            </div>
                          </div>
                        ),
                      });
                    }}
                    onMouseLeave={() => setTip(HIDDEN_TOOLTIP)}
                  />
                  <text
                    x={CHART_PAD.left + i * slot + slot / 2}
                    y={CHART_PAD.top + plotH + 16}
                    textAnchor="middle"
                    className="fill-ink-muted text-[11px] tabular-nums"
                  >
                    {m.label.split(" ")[0]}
                  </text>
                </g>
              );
            })}
          </svg>
          <ChartTooltip state={tip} containerWidth={width} />
        </div>
      )}
    </Card>
  );
}
