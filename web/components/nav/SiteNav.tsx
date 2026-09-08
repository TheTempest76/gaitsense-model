"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/lib/useTheme";
import { FootstepsIcon, HomeIcon, MoonIcon, PulseIcon, SunIcon } from "../icons";

const LINKS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/dashboard", label: "My data", icon: PulseIcon },
  { href: "/exercises", label: "Exercises", icon: FootstepsIcon },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Shared navigation, rendered once in the root layout so it's identical on
 * all three pages.
 *
 * Two physical surfaces, not a collapsing hamburger: a top bar (logo, inline
 * links from tablet width up, theme toggle) and — only below `sm` — a fixed
 * bottom tab bar with icon + label per destination. A hamburger trades one
 * tap for two and hides the destination names behind an icon that has to be
 * learned; for an audience that skews older or is a caregiver using this on
 * a phone, three always-visible, thumb-height targets are the safer default.
 */
export function SiteNav() {
  const pathname = usePathname();
  const { dark, toggle } = useTheme();

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-hairline-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-solid text-accent-on-solid"
            >
              <PulseIcon className="h-4 w-4" />
            </span>
            <span className="text-[15px]">GaitSense</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-colors ${
                    active ? "bg-accent-wash text-accent" : "text-ink-secondary hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle color theme"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-hairline-border bg-surface text-ink-secondary transition-colors hover:text-ink"
          >
            {dark ? <SunIcon className="h-[18px] w-[18px]" /> : <MoonIcon className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </header>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-hairline-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11.5px] font-medium transition-colors ${
                active ? "text-accent" : "text-ink-muted"
              }`}
            >
              <Icon className="h-6 w-6" />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
