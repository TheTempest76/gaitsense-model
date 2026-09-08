"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-[var(--radius-card)] border border-hairline-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6 ${className}`}
    >
      {children}
    </motion.section>
  );
}

export function CardHeading({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-ink-secondary">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
