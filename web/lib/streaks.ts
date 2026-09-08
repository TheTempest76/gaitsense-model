"use client";

/**
 * Client-only progress/streak tracking for the exercises pages, backed by
 * localStorage rather than a server — per the brief, this UI carries no
 * backend. That means progress is per-browser, not per-person: it won't
 * follow you to another device, and clearing site data resets it. Fine for a
 * prototype; a real deployment would need this behind a signed-in user.
 */

const KEY = "gaitsense-completed-days";

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getCompletedDays(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return []; // private browsing / storage blocked — degrade to "no history"
  }
}

/** Marks today as a completed day. Idempotent — finishing a second program
 * the same day doesn't create a duplicate or change the streak twice. */
export function markTodayComplete(): string[] {
  const days = getCompletedDays();
  const today = todayISO();
  if (!days.includes(today)) days.push(today);
  try {
    localStorage.setItem(KEY, JSON.stringify(days));
  } catch {
    /* storage blocked — the session still sees today as complete via the
     * returned array, it just won't survive a reload */
  }
  return days;
}

export interface Streak {
  current: number;
  best: number;
  /** Last 7 days, oldest first, each paired with whether it was completed —
   * for the calendar-strip display. */
  last7: { date: string; done: boolean }[];
}

export function computeStreak(days: string[]): Streak {
  const done = new Set(days);

  // Current streak: walk backward from today (or yesterday, if today isn't
  // logged yet — finishing "yesterday, then not yet today" shouldn't read as
  // a broken streak until the day actually lapses).
  let current = 0;
  let cursor = done.has(todayISO()) ? 0 : 1;
  if (cursor === 1 && !done.has(isoDaysAgo(1))) {
    current = 0;
  } else {
    while (done.has(isoDaysAgo(cursor))) {
      current++;
      cursor++;
    }
  }

  // Best streak: scan the full history for the longest run of consecutive
  // calendar days.
  const sorted = [...done].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev) {
      const prevDate = new Date(prev);
      const expected = new Date(prevDate);
      expected.setDate(expected.getDate() + 1);
      const expectedISO = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-${String(expected.getDate()).padStart(2, "0")}`;
      run = d === expectedISO ? run + 1 : 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prev = d;
  }
  best = Math.max(best, current);

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const date = isoDaysAgo(6 - i);
    return { date, done: done.has(date) };
  });

  return { current, best, last7 };
}
