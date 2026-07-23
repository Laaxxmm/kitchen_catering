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
      <div className="text-[11px] uppercase tracking-wide text-ik-ink-3">{chip.label}</div>
      <div
        className={
          "mt-1.5 text-[30px] font-bold leading-none tracking-tight tabular-nums " +
          VALUE_TONE[chip.tone ?? "ink"]
        }
      >
        {chip.value}
      </div>
    </>
  );
  const cls =
    "min-w-[130px] flex-1 rounded-2xl border border-ik-rule bg-ik-card p-4 transition" +
    (chip.href ? " hover:border-brand-300 hover:shadow-[0_4px_20px_rgba(20,25,20,0.06)]" : "");
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
