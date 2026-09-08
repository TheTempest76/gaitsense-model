import Link from "next/link";
import { FootstepsIcon } from "@/components/icons";
import type { Program } from "@/lib/exercise-programs";
import { totalMinutesLabel } from "@/lib/exercise-programs";

export function ProgramCard({ program }: { program: Program }) {
  return (
    <Link
      href={`/exercises/${program.id}`}
      className="group flex min-h-[200px] flex-col justify-between rounded-[var(--radius-card)] border border-hairline-border bg-surface p-6 transition-colors hover:border-baseline"
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center rounded-full bg-accent-wash px-2.5 py-1 text-[11.5px] font-medium text-accent">
            {program.focus}
          </span>
          <FootstepsIcon className="h-6 w-6 flex-none text-ink-muted transition-colors group-hover:text-accent" />
        </div>
        <h3 className="mt-3.5 text-[19px] font-semibold tracking-tight">{program.name}</h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-secondary">{program.tagline}</p>
      </div>

      <div className="mt-5 flex items-center gap-3 text-[13px] font-medium text-ink-secondary">
        <span>{totalMinutesLabel(program)}</span>
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-baseline" />
        <span>{program.difficulty}</span>
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-baseline" />
        <span>{program.exercises.length} exercises</span>
      </div>
    </Link>
  );
}
