"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeading } from "./ui/Card";
import type { Exercise, ExercisesResponse } from "@/lib/types";

function ExerciseCard({ ex, withReason, delay = 0 }: { ex: Exercise; withReason?: boolean; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="rounded-xl border border-hairline-border p-4"
    >
      <div className="flex items-baseline justify-between gap-2.5">
        <h3 className="text-sm font-semibold">{ex.name}</h3>
        <span className="whitespace-nowrap text-[11px] uppercase tracking-wide text-ink-muted">
          {ex.category.replace(/_/g, " ")}
        </span>
      </div>
      <div className="mt-1 text-[12.5px] font-medium text-series-1">{ex.dose}</div>

      {withReason && ex.reason && (
        <div className="mt-2 border-l-2 border-hairline pl-2.5 text-[12.5px] text-ink-secondary">
          {ex.reason}
        </div>
      )}

      <ol className="mt-2.5 list-decimal space-y-1 pl-[18px] text-[12.5px] text-ink-secondary">
        {ex.how.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <div className="mt-2.5 text-[12.5px] text-ink-muted">{ex.why}</div>
    </motion.div>
  );
}

export function ExercisesSection({ data }: { data: ExercisesResponse | null }) {
  const [showLibrary, setShowLibrary] = useState(false);

  return (
    <Card delay={0.25}>
      <CardHeading title="Exercises to work on" hint={data?.basis} />

      <div className="mb-4 rounded-lg border border-hairline-border border-l-[3px] p-3.5 text-[13px] text-ink-secondary" style={{ borderLeftColor: "var(--status-warning)" }}>
        {data?.safety_note ?? "…"}
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {data?.recommended.map((ex, i) => (
          <ExerciseCard key={ex.id} ex={ex} withReason delay={i * 0.04} />
        ))}
      </div>

      {data && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowLibrary((v) => !v)}
            className="text-[12.5px] text-ink-secondary hover:text-ink"
          >
            {showLibrary ? "Hide the full exercise library" : "Show the full exercise library"}
          </button>
          <AnimatePresence initial={false}>
            {showLibrary && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {data.library.map((ex) => (
                    <ExerciseCard key={ex.id} ex={ex} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
