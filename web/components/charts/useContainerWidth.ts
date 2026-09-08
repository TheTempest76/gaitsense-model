"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks a container's rendered width so SVG charts can size their viewBox
 * to it — ResizeObserver rather than a window resize listener, so a chart
 * inside a flex/grid layout reacts to its own box changing, not just the
 * viewport.
 *
 * Uses a callback ref rather than `useRef` + `useEffect`. These charts all
 * render an empty-state branch (no data yet) before the ref'd div exists at
 * all; a `useRef`/`useEffect([minWidth])` pair only re-measures when its
 * dependencies change, not when the DOM node behind the ref shows up later
 * on a subsequent render — so once real data arrived and the chart div
 * finally mounted, the effect would never re-run and the width would stay
 * stuck at `minWidth` forever. A callback ref is invoked by React exactly
 * when the node attaches (or detaches), independent of render branching, so
 * it can't miss a late mount.
 */
export function useContainerWidth<T extends HTMLElement>(minWidth = 280) {
  const [width, setWidth] = useState(minWidth);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback(
    (el: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el) return;

      setWidth(Math.max(minWidth, el.clientWidth));

      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width;
        if (w) setWidth(Math.max(minWidth, w));
      });
      ro.observe(el);
      observer.current = ro;
    },
    [minWidth]
  );

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, width };
}
