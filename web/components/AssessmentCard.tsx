"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeading } from "./ui/Card";
import { fmt, fmtInt } from "@/lib/chart-utils";
import type { Assessment } from "@/lib/types";

export function AssessmentCard({ assessment }: { assessment: Assessment | null }) {
  const [open, setOpen] = useState(false);
  if (!assessment) {
    return (
      <Card delay={0.05}>
        <CardHeading title="Gait pattern indicator" />
        <div className="text-sm text-ink-muted">Loading…</div>
      </Card>
    );
  }

  const card = assessment.model_card;

  return (
    <Card delay={0.05}>
      <CardHeading title="Gait pattern indicator" hint={card.what_it_measures} />

      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
        <span className="text-[22px] font-semibold tracking-tight">{assessment.label}</span>
        {assessment.probability !== null && (
          <span className="tabular-nums text-[13px] text-ink-secondary">
            P = {fmt(assessment.probability, 3)} · median of {fmtInt(assessment.n_scored_windows)}{" "}
            windows
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] text-ink-secondary">{assessment.detail}</p>

      <div className="mt-3.5 space-y-2 border-l-2 border-baseline pl-3.5 text-[13px] text-ink-secondary">
        <p>
          <strong className="font-semibold text-ink">This does not predict falls.</strong>{" "}
          {card.what_it_does_not_measure}
        </p>
        <p>{card.accuracy_plain}</p>
        <p>{card.trustworthy_instead}</p>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3.5 flex items-center gap-1.5 text-[12.5px] text-ink-secondary hover:text-ink"
        aria-expanded={open}
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}>
          ▸
        </motion.span>
        How accurate is this, and what is it actually measuring?
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.dl
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden text-[13px]"
          >
            {[
              ["What it measures", card.what_it_measures],
              ["What it does not measure", card.what_it_does_not_measure],
              ["Measured accuracy", card.accuracy_plain],
              ["Known confound", card.known_confound],
              ["Status", card.not_medical_advice],
            ].map(([term, desc]) => (
              <div key={term} className="pt-3 first:pt-3">
                <dt className="font-semibold text-ink">{term}</dt>
                <dd className="mt-0.5 text-ink-secondary">{desc}</dd>
              </div>
            ))}
          </motion.dl>
        )}
      </AnimatePresence>
    </Card>
  );
}
