import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default function PayablesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Finance · Payments"
        title="Payables — vendor payouts"
        description="Vendor bill payments arrive with Phase 2 procurement. Until then, this page is intentionally empty."
      />
      <div className="mb-4 flex gap-2 text-[12.5px]">
        <Link href="/payments/receivables" className="rounded-full bg-ik-paper-alt px-3 py-1 text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700">AR (customers)</Link>
        <Link href="/payments/payables" className="rounded-full bg-brand-500 px-3 py-1 text-white">AP (vendors)</Link>
      </div>
      <p className="text-[13px] text-ik-ink-3">No payables yet — Phase 2 wires VendorBills into this view.</p>
    </>
  );
}
