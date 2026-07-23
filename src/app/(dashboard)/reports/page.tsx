import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { ReportDownloads } from "./_components/ReportDownloads";

export default function ReportsHubPage() {
  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Operational reports"
        description="Per-order P&L lives on each order detail page (click 'P&L'). Cross-order reports + downloads here."
      />

      <section className="mb-8">
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Downloads</h2>
        <ReportDownloads />
      </section>

      <section>
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">On-screen — ledgers &amp; audit</h2>
        <div className="grid gap-3 sm:grid-cols-2 max-w-3xl">
          {ONSCREEN.map((r) => (
            <Link key={r.href} href={r.href} className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 hover:border-brand-200">
              <div className="font-medium text-[14px] text-ik-ink">{r.title}</div>
              <div className="mt-1 text-[12.5px] text-ik-ink-2">{r.desc}</div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

/** On-screen views for tracing usage and auditing. Access to each is gated
 *  at its own route; the tiles just point the way from one hub. */
const ONSCREEN: { href: string; title: string; desc: string }[] = [
  { href: "/reports/budget-vs-actual", title: "Monthly variance", desc: "Revenue, cost split, and variance vs prior month for a chosen calendar month." },
  { href: "/reports/stock-ledger", title: "Stock ledger", desc: "Per item, per store — opening, in, out, adjustments and closing balance for a date range." },
  { href: "/inventory/ingredients", title: "Kitchen stock", desc: "Every ingredient (incl. veg, frozen, non-veg) — on-hand qty, value, and per-item movement history." },
  { href: "/banquet/reports", title: "Banquet / F&B consumption", desc: "Cutlery, disposables and event equipment — receipts, issues and returns." },
  { href: "/admin/audit", title: "Audit log", desc: "Who did what, when — every recorded action across the system." },
];
