import Link from "next/link";

interface Props {
  storeKeeper: {
    openChefRequisitions: number;
    poAwaitingReceipt: number;
    lowStock: number;
  };
}

interface Row {
  count: number;
  label: string;
  href: string;
  tone: "urgent" | "info" | "muted";
}

/**
 * Right-column panel shown to the storekeeper in place of the receivables
 * donut. Three rows that summarise the storekeeper's daily worklist:
 * chef requisitions they need to fulfil, POs out to suppliers they may
 * need to receive, and ingredients running low.
 */
export function StockSnapshot({ storeKeeper }: Props) {
  const rows: Row[] = [
    {
      count: storeKeeper.openChefRequisitions,
      label: "Chef requisitions to fulfil",
      href: "/requisitions",
      tone: storeKeeper.openChefRequisitions > 0 ? "urgent" : "muted",
    },
    {
      count: storeKeeper.poAwaitingReceipt,
      label: "POs out — log goods on arrival",
      href: "/procurement/purchase-orders?status=SENT",
      tone: storeKeeper.poAwaitingReceipt > 0 ? "info" : "muted",
    },
    {
      count: storeKeeper.lowStock,
      label: "Ingredients below reorder level",
      href: "/inventory/ingredients?low=1",
      tone: storeKeeper.lowStock > 0 ? "urgent" : "muted",
    },
  ];

  return (
    <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
      <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Stock snapshot</div>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.label}>
            <Link
              href={r.href}
              className={
                "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-[13px] transition hover:border-brand-500 " +
                (r.tone === "urgent"
                  ? "border-amber bg-amber-wash"
                  : r.tone === "info"
                    ? "border-brand-200 bg-brand-50"
                    : "border-ik-rule bg-ik-card")
              }
            >
              <span className="text-ik-ink-2">{r.label}</span>
              <span className={"font-mono text-[16px] " + (r.tone === "muted" ? "text-ik-ink-3" : "text-ik-ink")}>
                {r.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11.5px] text-ik-ink-3">
        Click any row to drill in.
      </p>
    </section>
  );
}
