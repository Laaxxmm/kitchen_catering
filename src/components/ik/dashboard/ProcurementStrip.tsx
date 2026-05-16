import Link from "next/link";

interface Props {
  procurement: {
    prPendingApproval: number;
    prApprovedNoPO: number;
    poPendingApproval: number;
    poSentNotReceived: number;
    grnPendingBill: number;
    billsPendingMatch: number;
    billsPendingPayment: number;
  };
}

interface Stop {
  count: number;
  label: string;
  icon: string;
  href: string;
}

/**
 * Buy-side counterpart to OrderJourneyStrip. Same metaphor, narrower
 * stops since the procurement chain is shorter and less central. Sits
 * below the order journey on the dashboard, collapsed visually so it
 * doesn't compete for attention.
 */
export function ProcurementStrip({ procurement }: Props) {
  const stops: Stop[] = [
    {
      count: procurement.prPendingApproval,
      label: "Approve request",
      icon: "📋",
      href: "/procurement/purchase-requisitions?status=PENDING_APPROVAL",
    },
    {
      count: procurement.prApprovedNoPO,
      label: "Issue PO",
      icon: "✍️",
      href: "/procurement/purchase-requisitions?status=APPROVED",
    },
    {
      count: procurement.poPendingApproval,
      label: "Approve PO",
      icon: "🛂",
      href: "/procurement/purchase-orders?status=PENDING_APPROVAL",
    },
    {
      count: procurement.poSentNotReceived,
      label: "Awaiting delivery",
      icon: "🚚",
      href: "/procurement/purchase-orders?status=SENT",
    },
    {
      count: procurement.grnPendingBill,
      label: "Record bill",
      icon: "🧾",
      href: "/procurement/grns",
    },
    {
      count: procurement.billsPendingMatch,
      label: "Match bill",
      icon: "🔍",
      href: "/procurement/vendor-bills?status=PENDING_MATCH",
    },
    {
      count: procurement.billsPendingPayment,
      label: "Pay",
      icon: "💸",
      href: "/payments/payables",
    },
  ];
  const total = stops.reduce((s, x) => s + x.count, 0);
  // Earliest active stop — same "truly done" rule as the order strip:
  // a stop only gets the tick if no earlier (or same) stop has work.
  const firstActiveIndex = stops.findIndex((x) => x.count > 0);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Procurement chain</h2>
        <span className="text-[11.5px] text-ik-ink-3">
          {total} item{total === 1 ? "" : "s"} in the buy-side pipeline
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-ik-rule bg-ik-card p-3">
        <ol className="flex min-w-max items-start gap-0">
          {stops.map((s, i) => {
            const active = s.count > 0;
            // "Truly done" — see OrderJourneyStrip for the rule. We only
            // tick stages that every item has already cleared.
            const done = !active && firstActiveIndex !== -1 && i < firstActiveIndex;
            return (
              <li key={s.label} className="flex items-start">
                <Link
                  href={s.href}
                  className="group flex w-[100px] flex-col items-center text-center"
                  aria-label={`${s.label}: ${s.count}`}
                >
                  <div
                    className={
                      "relative flex h-11 w-11 items-center justify-center rounded-full border-2 text-[17px] transition " +
                      (active
                        ? "border-amber bg-amber-wash group-hover:bg-amber-wash"
                        : done
                          ? "border-amber bg-amber text-white"
                          : "border-ik-rule bg-ik-paper-alt opacity-70 group-hover:opacity-100")
                    }
                  >
                    {done ? (
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l4.5 4.5L19 7" />
                      </svg>
                    ) : (
                      <span aria-hidden>{s.icon}</span>
                    )}
                    {active && (
                      <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber px-1 font-mono text-[10px] font-medium text-white">
                        {s.count}
                      </span>
                    )}
                  </div>
                  <div
                    className={
                      "mt-1.5 text-[10.5px] " +
                      (active ? "font-medium text-ik-ink" : done ? "text-amber" : "text-ik-ink-3")
                    }
                  >
                    {s.label}
                  </div>
                </Link>
                {i < stops.length - 1 && (
                  <div
                    className={
                      "mt-5 h-[2px] w-5 " +
                      // Solid amber only where every item has crossed.
                      (firstActiveIndex !== -1 && i < firstActiveIndex
                        ? "bg-amber"
                        : "bg-ik-rule")
                    }
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
