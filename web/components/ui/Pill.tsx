export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "offline";
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline-border bg-surface px-2.5 py-1 text-[12.5px] text-ink-secondary whitespace-nowrap">
      {tone !== "neutral" && (
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{ background: tone === "good" ? "var(--status-good)" : "var(--text-muted)" }}
        />
      )}
      {children}
    </span>
  );
}

export function GhostButton({
  children,
  onClick,
  pressed = false,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`rounded-full border px-2.5 py-1 text-[12.5px] transition-colors ${
        pressed
          ? "border-baseline text-ink"
          : "border-hairline-border text-ink-secondary hover:text-ink"
      } bg-surface ${className}`}
    >
      {children}
    </button>
  );
}
