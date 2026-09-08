import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { ExerciseRunner } from "@/components/exercises/ExerciseRunner";
import { getProgram, PROGRAMS, totalMinutesLabel } from "@/lib/exercise-programs";

export function generateStaticParams() {
  return PROGRAMS.map((p) => ({ id: p.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const program = getProgram(id);
  return { title: program ? `${program.name} — GaitSense` : "Program not found — GaitSense" };
}

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const program = getProgram(id);
  if (!program) notFound();

  return (
    <main>
      <Container className="py-8 sm:py-10">
        <Link
          href="/exercises"
          className="text-[13.5px] font-medium text-ink-secondary hover:text-ink"
        >
          ← All exercises
        </Link>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{program.name}</h1>
          <span className="text-[13.5px] font-medium text-ink-secondary">
            {totalMinutesLabel(program)} · {program.difficulty}
          </span>
        </div>

        <div className="mx-auto mt-6 max-w-lg rounded-[var(--radius-card)] border border-hairline-border bg-surface p-6 sm:p-8">
          <ExerciseRunner program={program} />
        </div>
      </Container>
    </main>
  );
}
