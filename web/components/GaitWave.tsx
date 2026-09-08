/** Decorative rhythm line for the hero — a quiet nod to the cadence charts on
 * the dashboard, not a literal data visualisation (so it deliberately carries
 * no axis, legend, or numbers; a real chart belongs on the dashboard, not in
 * marketing copy). Positioned low-opacity and below the headline text so it
 * never competes with reading contrast. */
export function GaitWave({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 800 120" fill="none" className={className} aria-hidden="true">
      <path
        d="M0 70 Q 40 20 80 70 T 160 70 T 240 70 T 320 70 T 400 70 T 480 70 T 560 70 T 640 70 T 720 70 T 800 70"
        stroke="var(--accent)"
        strokeOpacity="0.35"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {[80, 160, 240, 320, 400, 480, 560, 640, 720].map((x, i) => (
        <circle key={x} cx={x} cy={70} r={i % 2 === 0 ? 4 : 2.5} fill="var(--accent)" opacity="0.4" />
      ))}
    </svg>
  );
}
