import Link from "next/link";
import type { PillTone } from "@/components/ik/StatusPill";

const VALUE_TONE: Record<PillTone | "ink", string> = {
  red: "text-alert",
  amber: "text-amber-700",
  green: "text-positive",
  grey: "text-ik-ink-3",
  ink: "text-ik-ink",
};

export interface StatChipDef {
  label: string;
  value: string | number;
  tone?: PillTone | "ink";
  href?: string;
}

function Chip({ chip }: { chip: StatChipDef }) {
  const body = (
    <>
      <div className={"font-mono text-[20px] leading-none " + VALUE_TONE[chip.tone ?? "ink"]}>{chip.value}</div>
      <div className="mt-1 text-[11px] text-ik-ink-3">{chip.label}</div>
    </>
  );
  const cls =
    "min-w-[120px] flex-1 rounded-md border border-ik-rule bg-ik-card p-3 transition" +
    (chip.href ? " hover:border-brand-200" : "");
  return chip.href ? (
    <Link href={chip.href} className={cls}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * Summary strip — a row of small stat chips (counts / money / stages) that
 * gives the headline before any detail. Shared across every redesigned
 * page so they read consistently. Folds to 2-up on mobile.
 */
export function SummaryStrip({ chips }: { chips: StatChipDef[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c, i) => (
        <Chip key={i} chip={c} />
      ))}
    </div>
  );
}
