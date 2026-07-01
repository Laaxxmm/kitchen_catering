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
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">On-screen</h2>
        <div className="grid gap-3 sm:grid-cols-2 max-w-3xl">
          <Link href="/reports/budget-vs-actual" className="rounded-md border border-ik-rule bg-ik-card p-4 hover:border-brand-200">
            <div className="font-medium text-[14px] text-ik-ink">Monthly variance</div>
            <div className="mt-1 text-[12.5px] text-ik-ink-2">Revenue, cost split, and variance vs prior month for a chosen calendar month.</div>
          </Link>
        </div>
      </section>
    </>
  );
}
