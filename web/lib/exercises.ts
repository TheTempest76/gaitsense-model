/**
 * Gait and balance exercise library, plus the rules that pick what to show.
 *
 * Ported from web/server/exercises.py — selection deliberately keys on the
 * *direct measurements* (daily step count, cadence, walking-bout length) and
 * never on the model's probability. The model is a 0.59-AUC retrospective
 * classifier (see risk.ts); basing exercise advice on it would give that
 * number a weight the evaluation does not support.
 *
 * The programmes referenced have real falls-prevention trial evidence in
 * older adults: the Otago Exercise Programme (progressive lower-limb
 * strength plus balance) and tai chi. Nothing here replaces an individual
 * assessment — see SAFETY_NOTE.
 */

import type { Exercise, ExercisesResponse } from "./types";

export const SAFETY_NOTE =
  "Work within what feels safe. Do balance exercises beside a kitchen " +
  "counter, a sturdy chair or a wall you can grab, and ideally with someone " +
  "nearby the first few times. If you have had a fall, feel dizzy, or are " +
  "unsteady on your feet, get a proper assessment from a GP or " +
  "physiotherapist before starting -- a tailored programme works better " +
  "than a generic one, and this page cannot examine you.";

export const LIBRARY: Exercise[] = [
  {
    id: "sit_to_stand",
    name: "Sit-to-stand",
    category: "strength",
    targets: ["leg strength", "getting out of a chair"],
    difficulty: 1,
    dose: "10 repetitions, 2 sets, most days",
    how: [
      "Sit forward in a firm chair with your feet flat and slightly back.",
      "Lean your chest forward over your knees, then stand up smoothly.",
      "Sit back down under control -- lowering slowly is the part that builds strength.",
      "Use your hands on the armrests only as much as you need, and less over time.",
    ],
    why:
      "Standing up is the single most repeated strength demand of the day, " +
      "and quadriceps strength is one of the better-established modifiable " +
      "factors in falls prevention. It is a core Otago exercise.",
  },
  {
    id: "heel_raises",
    name: "Heel raises",
    category: "strength",
    targets: ["calf strength", "push-off"],
    difficulty: 1,
    dose: "10-15 repetitions, 2 sets, most days",
    how: [
      "Stand tall behind a chair, hands resting on the back for balance.",
      "Rise onto the balls of your feet, hold for a second.",
      "Lower slowly, all the way down.",
      "Progress by using one hand, then fingertips, then one leg at a time.",
    ],
    why:
      "The calf provides push-off at the end of each step. Weak push-off " +
      "shortens the step and slows cadence, and shows up in the same " +
      "step-timing measures this device records.",
  },
  {
    id: "tandem_stance",
    name: "Tandem stance",
    category: "balance",
    targets: ["static balance", "side-to-side stability"],
    difficulty: 2,
    dose: "Hold 10-30 s each side, 2-3 times daily",
    how: [
      "Stand with one foot directly in front of the other, heel to toe.",
      "Hold a counter lightly, then reduce to fingertips as you steady.",
      "Hold, then swap which foot is in front.",
      "Progress by narrowing your support, then closing your eyes briefly.",
    ],
    why:
      "Narrowing your base trains the side-to-side control that keeps you " +
      "upright when something unexpected happens. Mediolateral instability " +
      "is one of the more consistent gait findings in people who fall.",
  },
  {
    id: "heel_toe_walk",
    name: "Heel-to-toe walking",
    category: "balance",
    targets: ["dynamic balance", "walking steadiness"],
    difficulty: 3,
    dose: "10 steps, 2-3 times, most days",
    how: [
      "Walk in a straight line along a counter or hallway wall.",
      "Place the heel of each step directly in front of the other toe.",
      "Look ahead rather than down at your feet.",
      "Keep a hand within reach of support the whole way.",
    ],
    why:
      "This is the walking version of tandem stance: it trains balance " +
      "while you are actually moving, which is when falls happen.",
  },
  {
    id: "sideways_walk",
    name: "Sideways walking",
    category: "balance",
    targets: ["hip strength", "lateral control"],
    difficulty: 2,
    dose: "10 steps each direction, 2 sets",
    how: [
      "Stand tall beside a counter, feet together.",
      "Step sideways with one foot, then bring the other to meet it.",
      "Travel ten steps one way, then ten steps back.",
      "Keep your toes pointing forwards throughout.",
    ],
    why:
      "Hip abductor strength controls how far your body sways sideways " +
      "over the stance leg on every single step.",
  },
  {
    id: "step_ups",
    name: "Step-ups",
    category: "strength",
    targets: ["leg strength", "stairs", "kerbs"],
    difficulty: 3,
    dose: "8-10 per leg, 2 sets, 3 days a week",
    how: [
      "Use the bottom step of a staircase with the handrail in reach.",
      "Step up with one leg, bring the other to meet it.",
      "Step down under control, leading with the same leg.",
      "Complete a set on one leg, then swap.",
    ],
    why:
      "Trains the single-leg strength that stairs and kerbs demand -- " +
      "common settings for falls, and a strength pattern that plain " +
      "walking does not build.",
  },
  {
    id: "walking_head_turns",
    name: "Walking with head turns",
    category: "dual_task",
    targets: ["gait stability", "attention while walking"],
    difficulty: 3,
    dose: "20 m, 2-3 times, a few days a week",
    how: [
      "Walk down a clear hallway at a comfortable pace.",
      "Every three steps, turn your head to look left, then right.",
      "Keep walking in a straight line while your head moves.",
      "Stop if you feel dizzy -- report persistent dizziness to your GP.",
    ],
    why:
      "Real walking is rarely undistracted. Gait that stays steady only " +
      "when you concentrate on it is a known falls-risk pattern, and " +
      "practising the divided-attention version is what addresses it.",
  },
  {
    id: "tai_chi",
    name: "Tai chi",
    category: "programme",
    targets: ["balance", "confidence", "leg strength"],
    difficulty: 2,
    dose: "A class 1-2 times a week",
    how: [
      "Look for a beginners or seniors class -- many run in community centres.",
      "Expect slow, continuous weight shifts rather than held postures.",
      "Consistency over months is what produces the effect.",
    ],
    why:
      "Tai chi has among the strongest randomised-trial evidence of any " +
      "falls-prevention exercise in community-dwelling older adults, " +
      "probably because it drills controlled weight transfer continuously.",
  },
  {
    id: "walking_volume",
    name: "Build up daily walking",
    category: "endurance",
    targets: ["general conditioning", "walking endurance"],
    difficulty: 1,
    dose: "Add ~1000 steps a day to your current average, then hold it",
    how: [
      "Take your current daily average as the starting point, not a target from a book.",
      "Add one short extra walk rather than one long one.",
      "Increase every week or two, not every day.",
    ],
    why:
      "Walking volume is the thing this device measures most reliably. " +
      "Building it gradually is safer than jumping to a round-number " +
      "target, and it gives every other exercise here something to carry over into.",
  },
];

const BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));

export function recommend(opts: {
  avgDailySteps: number | null;
  cadenceSpm: number | null;
  walkingSec: number | null;
}): ExercisesResponse {
  const picks: Exercise[] = [];
  const seen = new Set<string>();

  const add = (id: string, reason: string) => {
    const ex = BY_ID.get(id);
    if (ex && !seen.has(id)) {
      seen.add(id);
      picks.push({ ...ex, reason });
    }
  };

  const lowVolume = opts.avgDailySteps !== null && opts.avgDailySteps < 3000;
  const slowCadence = opts.cadenceSpm !== null && opts.cadenceSpm < 90;
  const shortWalking = opts.walkingSec !== null && opts.walkingSec < 600; // <10 min today

  if (lowVolume) {
    add(
      "walking_volume",
      `Your recent average is about ${Math.round(opts.avgDailySteps!).toLocaleString()} steps a day, ` +
        `which is on the low side -- building the base comes first.`
    );
    add("sit_to_stand", "Chair strength is the usual limiter when walking volume is low.");
  }

  if (slowCadence) {
    add(
      "heel_raises",
      `Measured cadence is around ${Math.round(opts.cadenceSpm!)} steps/min. Weak ` +
        `push-off is a common reason for a slow, short step.`
    );
    add(
      "step_ups",
      "Single-leg strength work tends to help a slow cadence more than walking further does."
    );
  }

  if (shortWalking) {
    add(
      "walking_volume",
      "Only a few minutes of walking was detected today -- short, " +
        "frequent walks are the easiest way to add to that."
    );
  }

  // Balance work is not conditional: it is the component with the strongest
  // falls-prevention evidence, and nothing this device measures would tell
  // you to skip it.
  add(
    "tandem_stance",
    "Balance training has the best falls-prevention evidence, regardless of what the walking numbers say."
  );
  add("sideways_walk", "Trains the hip control used on every step.");
  add("heel_toe_walk", "Progresses balance work into actual walking.");

  if (!lowVolume && !slowCadence) {
    add(
      "walking_head_turns",
      "Your walking numbers look steady, so the useful progression is " +
        "practising gait while your attention is divided."
    );
    add("tai_chi", "A good next step once the basics feel easy.");
  }

  return {
    recommended: picks,
    library: LIBRARY,
    safety_note: SAFETY_NOTE,
    basis:
      "Chosen from your measured step count, cadence and walking time. " +
      "The model's risk indicator is deliberately not used here -- at " +
      "0.59 AUC it is not accurate enough to base a recommendation on.",
  };
}
