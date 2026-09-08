"use client";

import type { ReactNode } from "react";

export interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: ReactNode;
}

export const HIDDEN_TOOLTIP: TooltipState = { visible: false, x: 0, y: 0, content: null };

/** Floating tooltip, positioned relative to the chart's wrapping container
 * (which must be `position: relative`). Flips to the left edge of the
 * pointer when it would otherwise overflow the container's right edge. */
export function ChartTooltip({ state, containerWidth }: { state: TooltipState; containerWidth: number }) {
  const estWidth = 170;
  const flips = state.x + 12 + estWidth > containerWidth - 4;
  const left = flips ? Math.max(4, state.x - estWidth - 12) : state.x + 12;

  return (
    <div
      className={`pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-hairline-border bg-surface px-2.5 py-2 text-[12.5px] text-ink shadow-[0_4px_14px_rgba(11,11,11,0.12)] transition-opacity duration-100 ${
        state.visible ? "opacity-100" : "opacity-0"
      }`}
      style={{ left, top: Math.max(4, state.y - 14) }}
    >
      {state.content}
    </div>
  );
}
