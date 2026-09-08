import { Card } from "./ui/Card";
import { AnimatedNumber } from "./ui/AnimatedNumber";

export function StatTile({
  label,
  value,
  digits = 0,
  unit,
  foot,
  delay = 0,
}: {
  label: string;
  value: number | null;
  digits?: number;
  unit?: string;
  foot?: string;
  delay?: number;
}) {
  return (
    <Card delay={delay} className="min-w-0">
      <div className="text-[12.5px] text-ink-secondary">{label}</div>
      <div className="mt-1.5 text-[28px] font-semibold tracking-tight leading-none">
        <AnimatedNumber value={value} digits={digits} />
        {unit && <span className="ml-1 text-sm font-medium text-ink-secondary">{unit}</span>}
      </div>
      <div className="mt-1.5 min-h-[16px] text-xs text-ink-muted">{foot ?? " "}</div>
    </Card>
  );
}
