"use client";

import { useEffect, useState } from "react";

/**
 * Shared dark/light theme state, backing both the dashboard's ThemeToggle
 * pill and the shared nav's icon toggle so there is one source of truth for
 * how a theme choice is read and persisted.
 */
export function useTheme() {
  // Start undecided so this doesn't fight the inline anti-flash script in
  // layout.tsx; sync from the DOM once mounted.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    // Reads document/window, neither of which exist during SSR — there is no
    // render-time value to compute here, only a post-mount read of browser
    // state, which is exactly what an effect is for.
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

  return { dark, toggle };
}
