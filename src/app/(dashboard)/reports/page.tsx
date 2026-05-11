import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

const REPORTS = [
  { href: "/reports/budget-vs-actual", title: "Monthly variance", desc: "Revenue, cost split, and variance vs prior month for a chosen calendar month." },
  { href: "/api/export/orders", title: "Orders — Excel export", desc: "All orders with status, value, customer, event date.", external: true },
];

export default function ReportsHubPage() {
  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Operational reports"
        description="Per-order P&L lives on each order detail page (click 'P&L'). Cross-order reports + exports here."
      />
      <div className="grid gap-3 sm:grid-cols-2 max-w-3xl">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href} className="rounded-md border border-ik-rule bg-ik-card p-4 hover:border-brand-200">
            <div className="font-medium text-[14px] text-ik-ink">{r.title}</div>
            <div className="mt-1 text-[12.5px] text-ik-ink-2">{r.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
