/**
 * Mock exercise-program catalogue for the /exercises pages.
 *
 * This is intentionally separate from lib/exercises.ts, which backs the real
 * /api/exercises endpoint used by the live dashboard (a flat list of single
 * exercises, selected server-side from measured step count and cadence).
 * The brief for these pages asked for a fitness-app-style catalogue of timed
 * *programs* with a run-through/timer flow — a different shape of content
 * for a different job — rather than reusing that endpoint's output. Static
 * data, no fetch: per the brief, this UI carries no backend.
 *
 * The exercises themselves (heel-to-toe walk, single-leg stand, sit-to-stand,
 * step-ups) are the same standard balance/strength moves used in real
 * falls-prevention programmes (see lib/exercises.ts's file header for the
 * Otago Exercise Programme / tai chi evidence this project already leans on)
 * — only the packaging into timed "programs" is new here.
 */

export interface ProgramStep {
  name: string;
  /** One-line cue shown under the name, e.g. "10 reps, slow and controlled." */
  cue: string;
  /** Suggested pace in seconds — drives the countdown timer even for
   * rep-based moves, where it's a target rather than a hold time. */
  durationSec: number;
  repBased: boolean;
  instructions: string[];
}

export interface Program {
  id: string;
  name: string;
  tagline: string;
  focus: "Balance" | "Strength" | "Warm-up" | "Full circuit";
  difficulty: "Beginner" | "Intermediate";
  exercises: ProgramStep[];
}

const HEEL_TO_TOE: ProgramStep = {
  name: "Heel-to-toe walk",
  cue: "10 steps in a straight line",
  durationSec: 40,
  repBased: true,
  instructions: [
    "Stand beside a counter or wall you can reach if needed.",
    "Place one foot directly in front of the other, heel touching toe.",
    "Take 10 slow steps in a straight line, looking ahead rather than down.",
    "Turn around and repeat back the way you came.",
  ],
};

const SINGLE_LEG_STAND: ProgramStep = {
  name: "Single-leg stand",
  cue: "Hold 15-30 seconds each side",
  durationSec: 30,
  repBased: false,
  instructions: [
    "Stand tall behind a sturdy chair, hands resting lightly on the back.",
    "Shift your weight onto one leg and lift the other a few inches off the floor.",
    "Hold as steady as you can — a little wobble is normal.",
    "Lower down, rest, then repeat on the other side.",
  ],
};

const SIT_TO_STAND: ProgramStep = {
  name: "Sit-to-stand",
  cue: "10 repetitions, slow and controlled",
  durationSec: 60,
  repBased: true,
  instructions: [
    "Sit forward in a firm chair with your feet flat and slightly back.",
    "Lean your chest forward over your knees, then stand up smoothly.",
    "Sit back down under control — lowering slowly is what builds strength.",
    "Use the armrests only as much as you need, and less over time.",
  ],
};

const STEP_UPS: ProgramStep = {
  name: "Step-ups",
  cue: "8 per leg, using a stair or low step",
  durationSec: 50,
  repBased: true,
  instructions: [
    "Use the bottom step of a staircase with the handrail in reach.",
    "Step up with one leg, bring the other to meet it.",
    "Step down under control, leading with the same leg.",
    "Complete a set on one leg, then swap.",
  ],
};

const TANDEM_STANCE: ProgramStep = {
  name: "Tandem stance",
  cue: "Hold 20 seconds each side",
  durationSec: 20,
  repBased: false,
  instructions: [
    "Stand with one foot directly in front of the other, heel to toe.",
    "Hold a counter lightly, then reduce to fingertips as you steady.",
    "Hold, then swap which foot is in front.",
  ],
};

const SIDEWAYS_WALK: ProgramStep = {
  name: "Sideways walking",
  cue: "10 steps each direction",
  durationSec: 40,
  repBased: true,
  instructions: [
    "Stand tall beside a counter, feet together.",
    "Step sideways with one foot, then bring the other to meet it.",
    "Travel ten steps one way, then ten steps back, toes forward throughout.",
  ],
};

const MARCH_IN_PLACE: ProgramStep = {
  name: "Marching in place",
  cue: "30 seconds, gentle pace",
  durationSec: 30,
  repBased: false,
  instructions: [
    "Stand tall, holding a counter if you'd like the support.",
    "Lift your knees gently, one at a time, like an easy march.",
    "Keep breathing normally and let your arms swing a little.",
  ],
};

const ANKLE_CIRCLES: ProgramStep = {
  name: "Ankle circles",
  cue: "8 circles each direction, each foot",
  durationSec: 30,
  repBased: true,
  instructions: [
    "Sit tall or hold a counter for balance.",
    "Lift one foot slightly and draw slow circles with your ankle.",
    "8 circles one way, 8 the other, then swap feet.",
  ],
};

export const PROGRAMS: Program[] = [
  {
    id: "steady-steps",
    name: "Steady Steps",
    tagline: "The balance basics — heel-to-toe walking and single-leg holds.",
    focus: "Balance",
    difficulty: "Beginner",
    exercises: [HEEL_TO_TOE, SINGLE_LEG_STAND, TANDEM_STANCE],
  },
  {
    id: "stronger-legs",
    name: "Stronger Legs",
    tagline: "Chair and step work to build the strength behind every stride.",
    focus: "Strength",
    difficulty: "Beginner",
    exercises: [SIT_TO_STAND, STEP_UPS, ANKLE_CIRCLES],
  },
  {
    id: "morning-mobility",
    name: "Morning Mobility",
    tagline: "A short, gentle warm-up to start the day moving well.",
    focus: "Warm-up",
    difficulty: "Beginner",
    exercises: [ANKLE_CIRCLES, MARCH_IN_PLACE, SIDEWAYS_WALK],
  },
  {
    id: "full-balance-circuit",
    name: "Full Balance Circuit",
    tagline: "Everything together — a complete session for a steadier walk.",
    focus: "Full circuit",
    difficulty: "Intermediate",
    exercises: [
      MARCH_IN_PLACE,
      SIT_TO_STAND,
      HEEL_TO_TOE,
      SINGLE_LEG_STAND,
      SIDEWAYS_WALK,
      STEP_UPS,
      TANDEM_STANCE,
    ],
  },
];

export function getProgram(id: string): Program | undefined {
  return PROGRAMS.find((p) => p.id === id);
}

export function totalSeconds(program: Program): number {
  return program.exercises.reduce((sum, e) => sum + e.durationSec, 0);
}

export function totalMinutesLabel(program: Program): string {
  const mins = Math.round(totalSeconds(program) / 60);
  return `${Math.max(1, mins)} min`;
}
