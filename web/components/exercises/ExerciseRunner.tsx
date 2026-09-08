"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { ButtonLink, Button } from "@/components/ui/Button";
import { markTodayComplete } from "@/lib/streaks";
import type { Program } from "@/lib/exercise-programs";
import { totalMinutesLabel } from "@/lib/exercise-programs";

type Phase = "intro" | "running" | "paused" | "done";

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const RING_R = 88;
const RING_C = 2 * Math.PI * RING_R;

export function ExerciseRunner({ program }: { program: Program }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(program.exercises[0]?.durationSec ?? 0);
  const loggedRef = useRef(false);

  const exercise = program.exercises[index];
  const isLast = index === program.exercises.length - 1;

  // `index` mirrored into a ref so the interval callback below always reads
  // the current exercise, without needing `index` in its dependency array
  // (which would tear down and recreate the interval on every exercise
  // change — harmless, but this is simpler to reason about).
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Countdown, and the transition to the next exercise (or to "done") when
  // it hits zero. A 1 Hz interval is plenty for a whole-second display and
  // avoids the drift/complexity a requestAnimationFrame loop would add for
  // no visible benefit at this granularity.
  //
  // Both the tick and the transition live in this one interval callback
  // rather than a countdown effect plus a second effect reacting to
  // `remaining === 0`: state changes here happen inside setInterval's
  // callback (deferred, one per second), never synchronously in an effect
  // body, which is what actually matters for avoiding cascading renders —
  // splitting the transition into its own `useEffect(() => {...}, [remaining])`
  // would fire that setState synchronously during the effect's own render
  // pass instead.
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev > 1) return prev - 1;

        const current = indexRef.current;
        if (current === program.exercises.length - 1) {
          setPhase("done");
          return 0;
        }
        const next = current + 1;
        setIndex(next);
        return program.exercises[next].durationSec;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, program.exercises]);

  // Log the day exactly once per completion. Setting state here is fine —
  // it's an external system (localStorage) rather than more React state, and
  // it's what a "run once when a value changes" effect is for.
  useEffect(() => {
    if (phase === "done" && !loggedRef.current) {
      loggedRef.current = true;
      markTodayComplete();
    }
  }, [phase]);

  function start() {
    setIndex(0);
    setRemaining(program.exercises[0].durationSec);
    loggedRef.current = false;
    setPhase("running");
  }

  function skip() {
    if (isLast) {
      setPhase("done");
    } else {
      const next = index + 1;
      setIndex(next);
      setRemaining(program.exercises[next].durationSec);
    }
  }

  function goBack() {
    if (index === 0) return;
    const prev = index - 1;
    setIndex(prev);
    setRemaining(program.exercises[prev].durationSec);
  }

  if (phase === "intro") {
    return (
      <div>
        <p className="text-[15px] leading-relaxed text-ink-secondary">{program.tagline}</p>

        <ol className="mt-6 space-y-3">
          {program.exercises.map((e, i) => (
            <li
              key={`${e.name}-${i}`}
              className="flex items-center gap-3.5 rounded-xl border border-hairline-border p-3.5"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-page text-[13px] font-semibold text-ink-secondary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold">{e.name}</div>
                <div className="text-[13px] text-ink-secondary">{e.cue}</div>
              </div>
              <span className="flex-none text-[13px] tabular-nums text-ink-muted">
                {formatClock(e.durationSec)}
              </span>
            </li>
          ))}
        </ol>

        <Button variant="primary" size="lg" className="mt-7 w-full" onClick={start}>
          <PlayIcon className="h-5 w-5" />
          Start · {totalMinutesLabel(program)}
        </Button>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col items-center py-6 text-center"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-wash text-accent">
          <CheckIcon className="h-8 w-8" />
        </span>
        <h2 className="mt-5 text-xl font-semibold tracking-tight">Nice work</h2>
        <p className="mt-1.5 max-w-sm text-[14.5px] leading-relaxed text-ink-secondary">
          {program.name} is logged for today — that&apos;s what keeps the streak going,
          not any single session.
        </p>
        <div className="mt-7 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button variant="secondary" size="lg" onClick={start}>
            Do it again
          </Button>
          <ButtonLink href="/exercises" size="lg">
            Back to exercises
          </ButtonLink>
        </div>
      </motion.div>
    );
  }

  // running or paused
  const progress = 1 - remaining / exercise.durationSec;

  return (
    <div>
      <div className="flex items-center gap-2">
        {program.exercises.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-accent-solid" : "bg-hairline"}`}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-8 flex flex-col items-center text-center"
        >
          <div className="relative h-56 w-56">
            <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
              <circle cx="100" cy="100" r={RING_R} stroke="var(--gridline)" strokeWidth="10" fill="none" />
              <circle
                cx="100"
                cy="100"
                r={RING_R}
                stroke="var(--accent-solid)"
                strokeWidth="10"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - progress)}
                style={{ transition: "stroke-dashoffset 1s linear" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[44px] font-semibold leading-none tabular-nums tracking-tight">
                {exercise.repBased ? formatClock(remaining) : remaining}
              </span>
              <span className="mt-1 text-[12.5px] text-ink-muted">
                {exercise.repBased ? "suggested pace" : "seconds"}
              </span>
            </div>
          </div>

          <h2 className="mt-6 text-[22px] font-semibold tracking-tight">{exercise.name}</h2>
          <p className="mt-1 text-[14.5px] text-ink-secondary">{exercise.cue}</p>

          <ul className="mt-5 w-full max-w-sm space-y-2 text-left text-[14px] leading-relaxed text-ink-secondary">
            {exercise.instructions.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-baseline" />
                {step}
              </li>
            ))}
          </ul>
        </motion.div>
      </AnimatePresence>

      <div className="mt-8 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={goBack}
          disabled={index === 0}
          className="h-12 rounded-full px-4 text-[14px] font-medium text-ink-secondary transition-colors hover:text-ink disabled:opacity-30"
        >
          Back
        </button>

        <button
          type="button"
          onClick={() => setPhase(phase === "running" ? "paused" : "running")}
          aria-label={phase === "running" ? "Pause" : "Resume"}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-solid text-accent-on-solid transition-transform active:scale-95"
        >
          {phase === "running" ? <PauseIcon className="h-7 w-7" /> : <PlayIcon className="h-7 w-7" />}
        </button>

        <button
          type="button"
          onClick={skip}
          className="h-12 rounded-full px-4 text-[14px] font-medium text-ink-secondary transition-colors hover:text-ink"
        >
          {isLast ? "Finish" : "Skip"}
        </button>
      </div>
    </div>
  );
}
