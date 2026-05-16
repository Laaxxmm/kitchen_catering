import Link from "next/link";
import { formatINR } from "@/lib/money";

interface Props {
  ap: {
    paidThisMonth: string;
    pending: string;
    overdue: string;
  };
}

/**
 * Vendor-payables counterpart to ARDonut. Three wedges:
 *   - blue   (paid this month)       — money out this month
 *   - amber  (pending, not overdue)  — supplier bills we still owe
 *   - red    (overdue)               — bills past their due date
 *
 * Same SVG-path math as ARDonut; click any wedge to drill into the
 * vendor-bills list filtered to that bucket.
 */
export function APDonut({ ap }: Props) {
  const paid = parseFloat(ap.paidThisMonth) || 0;
  const overdue = parseFloat(ap.overdue) || 0;
  const pendingTotal = parseFloat(ap.pending) || 0;
  // Pending includes overdue — split so the donut doesn't double-count.
  const pendingNotOverdue = Math.max(0, pendingTotal - overdue);

  const total = paid + pendingNotOverdue + overdue;
  const empty = total === 0;

  const size = 132;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 58;
  const innerR = 40;

  const wedges = [
    { value: paid, color: "#0F6E56", href: "/procurement/vendor-bills?status=PAID", label: "Paid this month" },
    { value: pendingNotOverdue, color: "#BA7517", href: "/procurement/vendor-bills?status=APPROVED", label: "Pending" },
    { value: overdue, color: "#A32D2D", href: "/procurement/vendor-bills?status=OVERDUE", label: "Overdue" },
  ];

  let startAngle = -Math.PI / 2;
  const paths = wedges.map((w) => {
    if (empty) return { ...w, d: "", pct: 0 };
    const pct = w.value / total;
    const endAngle = startAngle + pct * 2 * Math.PI;
    const d = arcPath(cx, cy, outerR, innerR, startAngle, endAngle);
    startAngle = endAngle;
    return { ...w, d, pct };
  });

  return (
    <section className="rounded-md border border-ik-rule bg-ik-card p-4">
      <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Money out (vendors)</div>
      <div className="flex items-center gap-5">
        <div className="shrink-0">
          {empty ? (
            <div className="flex h-[132px] w-[132px] items-center justify-center rounded-full border-2 border-dashed border-ik-rule text-[11.5px] text-ik-ink-3">
              No data
            </div>
          ) : (
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              {paths.map((p, i) =>
                p.pct > 0 ? (
                  <Link key={i} href={p.href}>
                    <path d={p.d} fill={p.color} stroke="#fff" strokeWidth={1}>
                      <title>{`${p.label}: ${formatINR(p.value.toFixed(2))}`}</title>
                    </path>
                  </Link>
                ) : null,
              )}
              <text
                x={cx}
                y={cy - 4}
                textAnchor="middle"
                className="fill-ik-ink-3"
                style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" }}
              >
                PAYABLES
              </text>
              <text
                x={cx}
                y={cy + 12}
                textAnchor="middle"
                className="fill-ik-ink"
                style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, fontWeight: 600 }}
              >
                {formatINR((pendingNotOverdue + overdue).toFixed(2))}
              </text>
            </svg>
          )}
        </div>
        <div className="flex-1">
          <ul className="grid gap-2 text-[12.5px]">
            {paths.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <Link href={p.href} className="flex items-center gap-2 text-ik-ink-2 hover:text-brand">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: p.color }}
                  />
                  {p.label}
                </Link>
                <span className="font-mono text-ik-ink">{formatINR(p.value.toFixed(2))}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  const sweep = end - start;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const x1 = cx + rOuter * Math.cos(start);
  const y1 = cy + rOuter * Math.sin(start);
  const x2 = cx + rOuter * Math.cos(end);
  const y2 = cy + rOuter * Math.sin(end);
  const x3 = cx + rInner * Math.cos(end);
  const y3 = cy + rInner * Math.sin(end);
  const x4 = cx + rInner * Math.cos(start);
  const y4 = cy + rInner * Math.sin(start);
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}
