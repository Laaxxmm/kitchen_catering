import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { SummaryStrip } from "@/components/ik/StatChips";
import { gateRolePage } from "@/server/rbac";
import { getOrderTrail } from "@/server/reports/order-trail";
import { humanizeStatus } from "@/lib/order-status";
import { formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

const dt = (iso: string | null) => (iso ? formatIST(new Date(iso), "d MMM yyyy, HH:mm") : "—");
const d = (iso: string | null) => (iso ? formatIST(new Date(iso), "d MMM yyyy") : "—");

export default async function OrderTrailPage({ params }: { params: Promise<{ id: string }> }) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const { id } = await params;
  const trail = await getOrderTrail(id);
  if (!trail) notFound();

  const { order, requisitions, purchaseOrders, customerInvoices, totals } = trail;

  return (
    <>
      <PageHeader
        eyebrow={`Order ${order.code}`}
        title="Audit trail"
        description={`${order.customer} · ${d(order.eventDate)} · ${humanizeStatus(order.status)} — every document raised for this order, in order.`}
        actions={
          <div className="flex gap-2">
            <a href={`/api/export/order-trail?orderId=${order.id}`} download><Button>Download Excel</Button></a>
            <Link href={`/orders/${order.id}`}><Button variant="outline">Back to order</Button></Link>
          </div>
        }
      />

      <div className="mb-5">
        <SummaryStrip
          chips={[
            { label: "Contract value", value: formatINRWhole(order.contractValue) },
            { label: "Procured (POs)", value: formatINRWhole(totals.procured), tone: "amber" },
            { label: "Paid to vendors", value: formatINRWhole(totals.paidToVendors), tone: "amber" },
            { label: "Invoiced", value: formatINRWhole(totals.invoiced), tone: "green" },
            { label: "Collected", value: formatINRWhole(totals.collected), tone: "green" },
          ]}
        />
      </div>

      <div className="grid gap-5">
        {/* 1 — Requisitions */}
        <Section title="Requisitions to store" count={requisitions.length}>
          {requisitions.length === 0 ? (
            <Empty>No requisitions raised for this order.</Empty>
          ) : (
            requisitions.map((r) => (
              <Doc key={r.no} head={`${r.no} · ${r.kind}`} meta={`${humanizeStatus(r.status)} · raised ${dt(r.createdAt)}${r.by ? ` · ${r.by}` : ""}`}>
                <ul className="grid gap-1 text-[12.5px]">
                  {r.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3 text-ik-ink-2">
                      <span className="text-ik-ink">{l.item}</span>
                      <span className="tabular-nums">
                        issued {l.issued}/{l.requested} {l.unit} · {humanizeStatus(l.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Doc>
            ))
          )}
        </Section>

        {/* 2 — Purchase orders, each with its GRNs + bills + payments */}
        <Section title="Purchase orders" count={purchaseOrders.length}>
          {purchaseOrders.length === 0 ? (
            <Empty>No purchase orders were raised for this order.</Empty>
          ) : (
            purchaseOrders.map((p) => (
              <Doc
                key={p.poNo}
                head={`${p.poNo} · ${p.vendor}`}
                meta={`${humanizeStatus(p.status)} · ${formatINRWhole(p.grandTotal)} · raised ${d(p.issueDate)}`}
              >
                <div className="grid gap-2 text-[12.5px] text-ik-ink-2">
                  <div>
                    Approved:{" "}
                    {p.managerApprovedAt ? `manager ${p.managerApprovedBy ?? ""} ${dt(p.managerApprovedAt)}` : "manager —"}
                    {p.adminApprovedAt ? ` · admin ${p.adminApprovedBy ?? ""} ${dt(p.adminApprovedAt)}` : ""}
                  </div>
                  <div>
                    <span className="font-medium text-ik-ink">Goods received:</span>{" "}
                    {p.grns.length === 0 ? "none yet" : p.grns.map((g) => `${g.grnNo} (${humanizeStatus(g.status)}, ${d(g.receivedAt)})`).join(" · ")}
                  </div>
                  <div className="grid gap-1">
                    <span className="font-medium text-ik-ink">Supplier bills:</span>
                    {p.bills.length === 0 ? (
                      <span>none yet</span>
                    ) : (
                      p.bills.map((b) => (
                        <div key={b.billNo} className="pl-2">
                          {b.billNo}
                          {b.vendorBillNo ? ` (${b.vendorBillNo})` : ""} · {formatINRWhole(b.grandTotal)} ·{" "}
                          {humanizeStatus(b.status)} · paid {formatINRWhole(b.amountPaid)}
                          {b.payments.length > 0 && (
                            <span className="text-ik-ink-3">
                              {" "}— {b.payments.map((pay) => `${formatINRWhole(pay.amount)} ${d(pay.paidAt)}${pay.reference ? ` #${pay.reference}` : ""}`).join(", ")}
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Doc>
            ))
          )}
        </Section>

        {/* 3 — Customer invoices + payments received */}
        <Section title="Customer invoices" count={customerInvoices.length}>
          {customerInvoices.length === 0 ? (
            <Empty>No customer invoice raised yet.</Empty>
          ) : (
            customerInvoices.map((inv) => (
              <Doc
                key={inv.invoiceNo}
                head={inv.invoiceNo}
                meta={`${humanizeStatus(inv.status)} · ${formatINRWhole(inv.grandTotal)} · issued ${d(inv.issuedAt)} · collected ${formatINRWhole(inv.amountPaid)}`}
              >
                {inv.payments.length === 0 ? (
                  <p className="text-[12.5px] text-ik-ink-3">No payments recorded.</p>
                ) : (
                  <ul className="grid gap-1 text-[12.5px] text-ik-ink-2">
                    {inv.payments.map((pay, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>{d(pay.paidAt)}{pay.reference ? ` · #${pay.reference}` : ""}</span>
                        <span className="tabular-nums text-positive">{formatINRWhole(pay.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Doc>
            ))
          )}
        </Section>
      </div>
    </>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
        {title}
        <span className="rounded-full bg-ik-paper-alt px-1.5 text-[10px] font-bold text-ik-ink-2 ring-1 ring-ik-rule tabular-nums">{count}</span>
      </h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Doc({ head, meta, children }: { head: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-brand-700">{head}</span>
        <span className="text-[11.5px] text-ik-ink-3">{meta}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-ik-rule bg-ik-card p-4 text-[12.5px] text-ik-ink-3">{children}</div>;
}
