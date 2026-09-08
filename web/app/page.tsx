"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { GaitWave } from "@/components/GaitWave";
import { AnkleBandIcon, PulseIcon, ScoreCardIcon } from "@/components/icons";

const STEPS = [
  {
    icon: AnkleBandIcon,
    title: "Wear it",
    body: "Clip the sensor above your ankle each morning. It's light enough to forget about, and there's nothing to charge more than once a week.",
  },
  {
    icon: PulseIcon,
    title: "It listens to your walk",
    body: "As you go about your day, it quietly measures your steps, pace, and steadiness — no button to press, no test to perform.",
  },
  {
    icon: ScoreCardIcon,
    title: "You get a clear score and a plan",
    body: "Check in whenever you like to see your Mobility Score, how it's trending, and a short set of exercises if it dips.",
  },
] as const;

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
};

export default function LandingPage() {
  return (
    <main>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden border-b border-hairline-border">
        <Container className="relative py-16 sm:py-24">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline-border bg-accent-wash px-3 py-1 text-[12.5px] font-medium text-accent">
              An ankle-worn gait monitor
            </span>
            <h1 className="mt-5 text-[2.5rem] font-semibold leading-[1.08] tracking-tight sm:text-[3.25rem]">
              See how your walk is changing, before a fall does.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-secondary sm:text-[18px]">
              GaitSense reads your gait from a small ankle sensor and turns it into a
              clear Mobility Score, a trend you can watch over weeks, and simple
              exercises to help you stay steady on your feet.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/dashboard" size="lg">
                View my Mobility Score
              </ButtonLink>
              <a
                href="#how-it-works"
                className="inline-flex h-14 items-center px-2 text-[15px] font-medium text-ink-secondary hover:text-ink"
              >
                See how it works ↓
              </a>
            </div>
          </motion.div>
        </Container>
        <GaitWave className="pointer-events-none absolute inset-x-0 bottom-0 h-20 w-full sm:h-28" />
      </section>

      {/* ------------------------------------------------------------- Problem */}
      <section className="border-b border-hairline-border bg-surface">
        <Container className="py-14 sm:py-16">
          <motion.div {...fadeUp} className="grid grid-cols-1 items-center gap-10 sm:grid-cols-[auto_1fr]">
            <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0">
              <span className="text-[4rem] font-semibold leading-none tracking-tight text-accent sm:text-[5.5rem]">
                1 in 3
              </span>
              <span className="text-[15px] font-medium text-ink-secondary sm:mt-1">
                adults over 65, every year
              </span>
            </div>
            <div className="max-w-xl">
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Falls in older adults are common, and the warning signs are usually
                invisible in day-to-day life.
              </h2>
              <p className="mt-3 text-[15.5px] leading-relaxed text-ink-secondary">
                A slower step, a shorter stride, a little more sway — changes like
                these build up gradually and rarely show up in a single walk down a
                hallway. Tracking them continuously is the only way to catch a trend
                early enough to do something about it.
              </p>
            </div>
          </motion.div>
        </Container>
      </section>

      {/* --------------------------------------------------------- How it works */}
      <section id="how-it-works" className="scroll-mt-20 border-b border-hairline-border">
        <Container className="py-14 sm:py-20">
          <motion.h2
            {...fadeUp}
            className="text-center text-2xl font-semibold tracking-tight sm:text-[2rem]"
          >
            How it works
          </motion.h2>
          <div className="mt-10 grid grid-cols-1 gap-8 sm:mt-14 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.title}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.08 }}
                className="relative rounded-[var(--radius-card)] border border-hairline-border bg-surface p-6"
              >
                <span className="absolute -top-3.5 left-6 flex h-7 w-7 items-center justify-center rounded-full bg-accent-solid text-[13px] font-semibold text-accent-on-solid">
                  {i + 1}
                </span>
                <step.icon className="mt-2 h-8 w-8 text-accent" />
                <h3 className="mt-4 text-[17px] font-semibold">{step.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-secondary">{step.body}</p>
              </motion.div>
            ))}
          </div>
        </Container>
      </section>

      {/* --------------------------------------------------------------- CTA */}
      <section className="bg-surface">
        <Container className="py-14 text-center sm:py-20">
          <motion.div {...fadeUp} className="mx-auto max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-[2rem]">
              Built for you, and for the people keeping an eye out for you.
            </h2>
            <p className="mt-3 text-[15.5px] leading-relaxed text-ink-secondary">
              Set it up once. Check your dashboard whenever it&apos;s useful — for you,
              or together with family or a caregiver.
            </p>
            <div className="mt-7 flex justify-center">
              <ButtonLink href="/dashboard" size="lg">
                View my Mobility Score
              </ButtonLink>
            </div>
          </motion.div>
        </Container>
      </section>

      <footer className="border-t border-hairline-border">
        <Container className="py-8 text-center text-[12.5px] leading-relaxed text-ink-muted">
          GaitSense is a research prototype, not a medical device. It does not
          diagnose or predict falls, and nothing here replaces advice from a
          clinician or physiotherapist.
        </Container>
      </footer>
    </main>
  );
}
