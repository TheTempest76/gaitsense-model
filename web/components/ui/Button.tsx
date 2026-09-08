import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-transform active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS = {
  primary: "bg-accent-solid text-accent-on-solid hover:brightness-105",
  secondary: "border border-hairline-border bg-surface text-ink hover:bg-page",
  ghost: "text-accent hover:bg-accent-wash",
} as const;

const SIZES = {
  // Large touch targets throughout — the smallest interactive size anywhere
  // in these three pages is 44px tall, the usual minimum recommendation,
  // and most primary actions are taller still given the older-adult audience.
  lg: "h-14 px-8 text-[16px]",
  md: "h-11 px-5 text-[14.5px]",
} as const;

type Variant = keyof typeof VARIANTS;
type Size = keyof typeof SIZES;

interface CommonProps {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  className?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  children,
  className = "",
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  children,
  className = "",
}: CommonProps & { href: string }) {
  return (
    <Link href={href} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}>
      {children}
    </Link>
  );
}
