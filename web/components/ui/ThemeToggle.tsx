"use client";

import { useTheme } from "@/lib/useTheme";

export function ThemeToggle() {
  const { dark, toggle } = useTheme();

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
