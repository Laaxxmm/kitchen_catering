import { db } from "@/server/db";

/**
 * The full document trail for one catering order — every step that actually
 * happened, in order: chef + banquet requisitions and their issued lines,
 * the purchase orders raised for shortfalls (with who approved them, the
 * GRNs that received the goods, and the supplier bills + payments against
 * them), and the customer invoice(s) with payments received. Read-only join
 * over records the app already writes, so it reconciles to reality and can
 * be audited later. Non-"use server" so the page and the Excel export share
 * it.
 */
const s = (v: { toString(): string } | null | undefined) => (v == null ? "0" : v.toString());
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function getOrderTrail(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      status: true,
      contractValue: true,
      eventDate: true,
      customer: { select: { name: true } },
    },
  });
  if (!order) return null;

  const [chefReqs, banquetReqs, pos, invoices] = await Promise.all([
    db.chefRequisition.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
      select: {
        requisitionNo: true, status: true, createdAt: true,
        createdBy: { select: { name: true } },
        lines: {
          select: {
            requestedQty: true, issuedQty: true, unit: true, status: true,
            ingredient: { select: { name: true } },
          },
        },
      },
    }),
    db.banquetRequisition.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
      select: {
        requisitionNo: true, status: true, createdAt: true,
        lines: {
          select: {
            requestedQty: true, issuedQty: true, status: true,
            item: { select: { name: true, unit: true } },
          },
        },
      },
    }),
    db.vendorPO.findMany({
      where: { orderId },
      orderBy: { issueDate: "asc" },
      select: {
        poNo: true, status: true, grandTotal: true, issueDate: true,
        vendor: { select: { name: true } },
        managerApprovedAt: true, managerApprovedBy: { select: { name: true } },
        adminApprovedAt: true, adminApprovedBy: { select: { name: true } },
        grns: { orderBy: { receivedAt: "asc" }, select: { grnNo: true, status: true, receivedAt: true } },
        bills: {
          orderBy: { issueDate: "asc" },
          select: {
            billNo: true, vendorBillNo: true, status: true, grandTotal: true, amountPaid: true, issueDate: true,
            payments: {
              where: { reversedAt: null },
              orderBy: { paidAt: "asc" },
              select: { amount: true, paidAt: true, reference: true },
            },
          },
        },
      },
    }),
    db.customerInvoice.findMany({
      where: { orderId, status: { not: "CANCELLED" } },
      orderBy: { issuedAt: "asc" },
      select: {
        invoiceNo: true, status: true, grandTotal: true, amountPaid: true, issuedAt: true,
        payments: {
          where: { reversedAt: null },
          orderBy: { paidAt: "asc" },
          select: { amount: true, paidAt: true, reference: true },
        },
      },
    }),
  ]);

  const requisitions = [
    ...chefReqs.map((r) => ({
      no: r.requisitionNo, kind: "Chef" as const, status: r.status, createdAt: iso(r.createdAt),
      by: r.createdBy?.name ?? null,
      lines: r.lines.map((l) => ({ item: l.ingredient?.name ?? "—", requested: s(l.requestedQty), issued: s(l.issuedQty), unit: l.unit, status: l.status })),
    })),
    ...banquetReqs.map((r) => ({
      no: r.requisitionNo, kind: "Banquet" as const, status: r.status, createdAt: iso(r.createdAt), by: null,
      lines: r.lines.map((l) => ({ item: l.item?.name ?? "—", requested: s(l.requestedQty), issued: s(l.issuedQty), unit: l.item?.unit ?? "", status: l.status })),
    })),
  ];

  const purchaseOrders = pos.map((p) => ({
    poNo: p.poNo, vendor: p.vendor.name, status: p.status, grandTotal: s(p.grandTotal), issueDate: iso(p.issueDate),
    managerApprovedAt: iso(p.managerApprovedAt), managerApprovedBy: p.managerApprovedBy?.name ?? null,
    adminApprovedAt: iso(p.adminApprovedAt), adminApprovedBy: p.adminApprovedBy?.name ?? null,
    grns: p.grns.map((g) => ({ grnNo: g.grnNo, status: g.status, receivedAt: iso(g.receivedAt) })),
    bills: p.bills.map((b) => ({
      billNo: b.billNo, vendorBillNo: b.vendorBillNo, status: b.status, grandTotal: s(b.grandTotal), amountPaid: s(b.amountPaid), issueDate: iso(b.issueDate),
      payments: b.payments.map((pay) => ({ amount: s(pay.amount), paidAt: iso(pay.paidAt), reference: pay.reference })),
    })),
  }));

  const customerInvoices = invoices.map((inv) => ({
    invoiceNo: inv.invoiceNo, status: inv.status, grandTotal: s(inv.grandTotal), amountPaid: s(inv.amountPaid), issuedAt: iso(inv.issuedAt),
    payments: inv.payments.map((pay) => ({ amount: s(pay.amount), paidAt: iso(pay.paidAt), reference: pay.reference })),
  }));

  const num = (x: string) => Number(x);
  const totals = {
    procured: purchaseOrders.reduce((t, p) => t + num(p.grandTotal), 0),
    billed: purchaseOrders.reduce((t, p) => t + p.bills.reduce((s2, b) => s2 + num(b.grandTotal), 0), 0),
    paidToVendors: purchaseOrders.reduce((t, p) => t + p.bills.reduce((s2, b) => s2 + num(b.amountPaid), 0), 0),
    invoiced: customerInvoices.reduce((t, i) => t + num(i.grandTotal), 0),
    collected: customerInvoices.reduce((t, i) => t + num(i.amountPaid), 0),
  };

  return {
    order: {
      id: order.id, code: order.code, status: order.status,
      contractValue: s(order.contractValue), eventDate: iso(order.eventDate),
      customer: order.customer.name,
    },
    requisitions,
    purchaseOrders,
    customerInvoices,
    totals,
  };
}

export type OrderTrail = NonNullable<Awaited<ReturnType<typeof getOrderTrail>>>;
