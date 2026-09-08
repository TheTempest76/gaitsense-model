"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tweens a displayed number toward `value` whenever it changes — the stat
 * tiles refresh every 5 s as new device data arrives, and a hard swap reads
 * as flicker where a short tween reads as "live."
 *
 * A plain rAF loop rather than a library: the only requirement is "ease
 * toward a new target," and framer-motion's spring is tuned for
 * position/opacity, not for numbers that should visibly stop counting.
 */
export function AnimatedNumber({
  value,
  digits = 0,
  className,
}: {
  value: number | null;
  digits?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState<number | null>(value);
  const from = useRef<number | null>(value);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);

    if (value === null) {
      // No target to tween toward. Don't touch `display` here — the
      // rendered value below ignores it whenever `value` is null, so this
      // effect has nothing to synchronize and can skip setState entirely.
      from.current = null;
      return;
    }

    const start = from.current ?? value;
    const startTime = performance.now();
    const duration = 500;

    function tick(now: number) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(start + (value! - start) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = value;
    }
    raf.current = requestAnimationFrame(tick);

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value]);

  const shown = value === null ? null : display;

  return (
    <span className={`tabular-nums ${className ?? ""}`}>
      {shown === null ? "—" : shown.toFixed(digits)}
    </span>
  );
}
