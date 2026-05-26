import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { banquetSummary } from "@/server/actions/banquet";

export const dynamic = "force-dynamic";

export default async function BanquetLandingPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE]);
  const s = await banquetSummary();

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Banquet store"
        description="F&B service-side disposables — paper cups, meal trays, tissue, foil, takeaway boxes, condiments. Record stock IN from vendors and stock OUT to events / room service."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/banquet/issues/new"><Button>Issue to event</Button></Link>
            <Link href="/banquet/receipts/new"><Button variant="outline">Record receipt</Button></Link>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <KPI label="Items in catalog" value={s.itemCount} />
        <KPI label="Receipts this week" value={s.receiptsLastWeek} />
        <KPI label="Issues this week" value={s.issuesLastWeek} />
        <KPI label="Low-stock items" value={s.lowStock.length} alert={s.lowStock.length > 0} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-md border border-ik-rule bg-ik-card">
          <header className="flex items-center justify-between border-b border-ik-rule p-3">
            <div className="text-[12px] font-medium text-ik-ink-2">
              Low stock (at or below threshold)
            </div>
            <Link href="/banquet/items" className="text-[11px] text-ik-ink-3 hover:text-brand">
              All items →
            </Link>
          </header>
          {s.lowStock.length === 0 ? (
            <p className="p-4 text-[12.5px] text-ik-ink-3">Nothing flagged.</p>
          ) : (
            <ul className="divide-y divide-ik-rule">
              {s.lowStock.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 p-3 text-[12.5px]">
                  <span>
                    {i.name}{" "}
                    {i.category && (
                      <span className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                        {i.category}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11.5px]">
                    <span className="text-alert">{i.currentStock}</span>
                    <span className="text-ik-ink-3"> / min {i.minStock} {i.unit}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-ik-rule bg-ik-card">
          <header className="flex items-center justify-between border-b border-ik-rule p-3">
            <div className="text-[12px] font-medium text-ik-ink-2">
              Top consumed this week
            </div>
            <Link href="/banquet/reports" className="text-[11px] text-ik-ink-3 hover:text-brand">
              Full reports →
            </Link>
          </header>
          {s.topItemsThisWeek.length === 0 ? (
            <p className="p-4 text-[12.5px] text-ik-ink-3">No issues recorded this week.</p>
          ) : (
            <ul className="divide-y divide-ik-rule">
              {s.topItemsThisWeek.map((t) => (
                <li key={t.itemId} className="flex items-center justify-between gap-3 p-3 text-[12.5px]">
                  <span>{t.name}</span>
                  <span className="font-mono text-[11.5px]">
                    <span className="text-ik-ink">{t.consumed}</span>
                    <span className="text-ik-ink-3"> {t.unit}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-[12px]">
        <Link href="/banquet/items" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Items</Link>
        <Link href="/banquet/receipts" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Receipts</Link>
        <Link href="/banquet/issues" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Issues</Link>
        <Link href="/banquet/reports" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Reports</Link>
      </div>
    </>
  );
}

function KPI({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border p-3 " +
        (alert ? "border-alert/30 bg-alert/5" : "border-ik-rule bg-ik-card")
      }
    >
      <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{label}</div>
      <div className={"mt-1 font-mono text-[20px] " + (alert ? "text-alert" : "text-ik-ink")}>
        {value}
      </div>
    </div>
  );
}
