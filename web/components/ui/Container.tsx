import type { ReactNode } from "react";

/** The one page width/padding rhythm used by every page — landing,
 * dashboard, and exercises all share it so nothing visually "jumps" between
 * routes. */
export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto max-w-[1080px] px-5 sm:px-6 ${className}`}>{children}</div>;
}
