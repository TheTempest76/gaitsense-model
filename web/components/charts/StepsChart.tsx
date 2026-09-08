"use client";

import { useState } from "react";
import { Card, CardHeading } from "../ui/Card";
import { GhostButton } from "../ui/Pill";
import { DataTable } from "./DataTable";
import { ChartTooltip, HIDDEN_TOOLTIP, type TooltipState } from "./ChartTooltip";
import { useContainerWidth } from "./useContainerWidth";
import { barPath, CHART_PAD, fmt, fmtDay, fmtInt, niceMax } from "@/lib/chart-utils";
import type { DailyRow } from "@/lib/types";

const HEIGHT = 220;

export function StepsChart({ days }: { days: DailyRow[] | null }) {
  const [showTable, setShowTable] = useState(false);
  const { ref, width } = useContainerWidth<HTMLDivElement>(320);
  const [tip, setTip] = useState<TooltipState>(HIDDEN_TOOLTIP);

  const rows = (days ?? []).slice(-30);
  const plotW = width - CHART_PAD.left - CHART_PAD.right;
  const plotH = HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const yMax = niceMax(Math.max(1, ...rows.map((d) => d.steps || 0)));
  const GAP = 2;
  const slot = rows.length ? plotW / rows.length : plotW;
  const barW = Math.max(2, slot - GAP);

  const yTicks = [0, 1, 2, 3, 4].map((i) => (yMax * i) / 4);
  const xLabelIdx = rows.length
    ? [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])]
    : [];
  const last = rows[rows.length - 1];

  return (
    <Card delay={0.1}>
      <CardHeading
        title="Daily steps"
        hint="Steps counted only while the device detected walking, over the last 30 days."
        action={
          <GhostButton pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Chart" : "Table"}
          </GhostButton>
        }
      />

      {!rows.length ? (
        <div className="py-10 text-center text-[13px] text-ink-muted">
          No readings yet — power up the node and start walking.
        </div>
      ) : showTable ? (
        <DataTable
          head={["Day", "Steps", "Walking (min)", "Cadence"]}
          rows={rows.map((d) => [
            fmtDay(d.day),
            fmtInt(d.steps),
            fmt((d.walking_sec || 0) / 60, 0),
            fmt(d.cadence_spm, 0),
          ])}
        />
      ) : (
        <div ref={ref} className="relative no-x-overflow">
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            width={width}
            height={HEIGHT}
            role="img"
            aria-label="Daily step count for the last 30 days"
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

            {rows.map((d, i) => {
              const v = d.steps || 0;
              const h = (v / yMax) * plotH;
              const x = CHART_PAD.left + i * slot + GAP / 2;
              const y = CHART_PAD.top + plotH - h;
              return (
                <g key={d.day}>
                  {h > 0 && (
                    <path d={barPath(x, y, barW, h, 4)} fill="var(--series-1)" />
                  )}
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
                            <div className="text-ink-secondary">{fmtDay(d.day)}</div>
                            <div>
                              <span className="tabular-nums font-semibold">{fmtInt(v)}</span> steps
                            </div>
                            <div className="text-ink-secondary">
                              {fmt((d.walking_sec || 0) / 60, 0)} min walking
                              {d.cadence_spm ? ` · ${fmt(d.cadence_spm, 0)} steps/min` : ""}
                            </div>
                          </div>
                        ),
                      });
                    }}
                    onMouseLeave={() => setTip(HIDDEN_TOOLTIP)}
                  />
                </g>
              );
            })}

            {last && last.steps > 0 && (
              <text
                x={CHART_PAD.left + plotW}
                y={CHART_PAD.top + plotH - (last.steps / yMax) * plotH - 6}
                textAnchor="end"
                className="fill-ink-muted text-[11px] tabular-nums"
              >
                {fmtInt(last.steps)}
              </text>
            )}

            {xLabelIdx.map((i) => (
              <text
                key={i}
                x={CHART_PAD.left + i * slot + slot / 2}
                y={CHART_PAD.top + plotH + 16}
                textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}
                className="fill-ink-muted text-[11px] tabular-nums"
              >
                {fmtDay(rows[i].day)}
              </text>
            ))}
          </svg>
          <ChartTooltip state={tip} containerWidth={width} />
        </div>
      )}
    </Card>
  );
}
