import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

const SECTIONS = [
  { href: "/procurement/vendors", title: "Vendors", desc: "Vendor master — GSTIN, payment terms, MSME flag." },
  { href: "/procurement/purchase-requisitions", title: "Purchase requisitions", desc: "Internal request → approval → ready for a vendor PO. Auto-created from chef-requisition shortages." },
  { href: "/procurement/purchase-orders", title: "Vendor POs", desc: "Issue a PO with tiered approval. ≤₹1L auto, ≤₹10L manager, >₹10L admin." },
  { href: "/procurement/grns", title: "Goods receipts", desc: "Goods receipt notes. Atomically posts IngredientReceipt + updates moving-average cost." },
  { href: "/procurement/vendor-bills", title: "Vendor bills", desc: "3-way match: bill ↔ PO ↔ GRN. Pay through /payments/payables." },
];

export default function ProcurementHubPage() {
  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Vendor pipeline"
        description="PR → PO → GRN → vendor bill. Chef-requisition shortages auto-spawn DRAFT PRs."
      />
      <div className="grid gap-3 sm:grid-cols-2 max-w-4xl">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-md border border-ik-rule bg-ik-card p-4 hover:border-brand-200"
          >
            <div className="font-medium text-[14px] text-ik-ink">{s.title}</div>
            <div className="mt-1 text-[12.5px] text-ik-ink-2">{s.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
