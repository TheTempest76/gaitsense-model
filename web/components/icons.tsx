/** Small hand-drawn line icons for the shared nav — 2px stroke, no fill,
 * matching the restrained-motion / no-stock-imagery design direction. Kept
 * as inline SVG rather than an icon font/library: three icons don't justify
 * a dependency, and it keeps the nav's weight consistent with the rest of
 * the app's hand-built SVG (the charts are the same approach). */

type IconProps = { className?: string };

export function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h3v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3a1 1 0 0 0 1-1v-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PulseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 12h4l2 6 4-14 2 8h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Two alternating footprints — sole plus toe cluster, the standard
 * "walking/steps" pictogram, legible even at 16px in the nav bar (the
 * previous version, two bare ellipses, read as illegible dots at that
 * size). */
export function FootstepsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <ellipse cx="8.3" cy="15.2" rx="2.5" ry="3.6" />
      <circle cx="6.9" cy="9.4" r="1.05" />
      <circle cx="8.4" cy="8.5" r="1.05" />
      <circle cx="9.9" cy="9.1" r="0.95" />
      <ellipse cx="15.9" cy="10" rx="2.5" ry="3.6" />
      <circle cx="14.5" cy="15.8" r="0.95" />
      <circle cx="16" cy="16.7" r="1.05" />
      <circle cx="17.5" cy="16.1" r="1.05" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A wearable sensor pod on its strap — "wear it." */
export function AnkleBandIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="7" y="8" width="10" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M9.5 8V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V8M9.5 16v2.5a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** A rising trend line inside a card outline — "get your score and plan." */
export function ScoreCardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M7 15.5 10 12l2.5 2 4.5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 12.5 9.5 17 19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M7 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 10.5a6 6 0 0 1 12 0c0 3.5 1.2 5 2 6H4c.8-1 2-2.5 2-6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 19.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="3.3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FlameIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2.5c1 3 4 4.2 4 8a4 4 0 0 1-8 0c0-1.2.5-2 1-2.6.2 1 1 1.6 1.6 1.2C11.4 8 9.5 6.8 10 4.5c1 .6 1.6 1.7 2 3 0-2.2-.8-3.7-2-5Z"
        fill="currentColor"
      />
    </svg>
  );
}
