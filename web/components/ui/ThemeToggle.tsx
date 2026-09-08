"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  // Start undecided so this doesn't fight the inline anti-flash script in
  // layout.tsx; sync from the DOM once mounted.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    // Reads document/window, neither of which exist during SSR — there is no
    // render-time value to compute here, only a post-mount read of browser
    // state, which is exactly what an effect is for. (The alternative,
    // useSyncExternalStore, still needs a getServerSnapshot that disagrees
    // with the client on first paint, trading this warning for a real
    // hydration mismatch — worse.)
    const attr = document.documentElement.getAttribute("data-theme");
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(attr ? attr === "dark" : systemDark);
  }, []);

  function toggle() {
    const next = !(dark ?? false);
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("gaitsense-theme", next ? "dark" : "light");
    } catch {
      /* private mode / storage blocked — theme just won't persist */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-full border border-hairline-border bg-surface px-2.5 py-1 text-[12.5px] text-ink-secondary transition-colors hover:text-ink"
      aria-label="Toggle color theme"
    >
      {dark === null ? "Theme" : dark ? "Dark" : "Light"}
    </button>
  );
}
