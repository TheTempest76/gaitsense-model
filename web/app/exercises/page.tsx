import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { ProgramCard } from "@/components/exercises/ProgramCard";
import { StreakStrip } from "@/components/exercises/StreakStrip";
import { PROGRAMS } from "@/lib/exercise-programs";

export const metadata: Metadata = {
  title: "Exercises — GaitSense",
  description: "Balance and strength programs for steadier walking.",
};

export default function ExercisesPage() {
  return (
    <main>
      <Container className="py-8 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Exercises</h1>
        <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-ink-secondary">
          Short, balance-focused programs you can do at home. Pick one to see the
          steps and start the timer.
        </p>

        <div className="mt-6">
          <StreakStrip />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROGRAMS.map((program) => (
            <ProgramCard key={program.id} program={program} />
          ))}
        </div>

        <p className="mt-8 rounded-[var(--radius-card)] border border-hairline-border border-l-[3px] p-4 text-[13.5px] leading-relaxed text-ink-secondary [border-left-color:var(--status-warning)]">
          Work within what feels safe. Do balance exercises beside a kitchen counter,
          a sturdy chair, or a wall you can reach, ideally with someone nearby the
          first few times. If you have had a fall recently, feel dizzy, or are
          unsteady on your feet, check with a GP or physiotherapist before starting.
        </p>
      </Container>
    </main>
  );
}
