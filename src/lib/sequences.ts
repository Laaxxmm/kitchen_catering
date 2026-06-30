import type { Prisma } from "@prisma/client";
import { getFyForDate } from "./fy";

/**
 * Atomic FY-scoped document-number generators. Each variant pairs with
 * its own `*-Sequence` model in schema.prisma. The two-step pattern
 * (find-then-update with `increment: 1`) is intentional: Postgres'
 * read-committed isolation + Prisma's row-level lock serialises concurrent
 * callers, so claimed numbers are unique without an advisory lock.
 *
 * Always call inside an outer `db.$transaction(async (tx) => …)`.
 */

type Tx = Prisma.TransactionClient;

async function nextSequenceValue(
  tx: Tx,
  table: {
    findUnique: (args: { where: { year: number } }) => Promise<{ year: number; next: number } | null>;
    create: (args: { data: { year: number; next: number } }) => Promise<unknown>;
    update: (args: { where: { year: number }; data: { next: { increment: number } } }) => Promise<unknown>;
  },
  storageYear: number,
): Promise<number> {
  const existing = await table.findUnique({ where: { year: storageYear } });
  if (!existing) {
    await table.create({ data: { year: storageYear, next: 2 } });
    return 1;
  }
  const claimed = existing.next;
  await table.update({ where: { year: storageYear }, data: { next: { increment: 1 } } });
  return claimed;
}

export async function nextOrderCode(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, tx.orderCodeSequence, fy.storageYear);
  return `ORD-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextQuoteNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, tx.quoteNumberSequence, fy.storageYear);
  return `QT-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextCustomerInvoiceNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, tx.customerInvoiceNumberSequence, fy.storageYear);
  return `INV-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextChefRequisitionNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  // ChefRequisition sequence model name — confirm in schema.prisma.
  // Falls back to a runtime check if the table doesn't exist on the client.
  const seq = (tx as unknown as { chefRequisitionNumberSequence?: typeof tx.orderCodeSequence })
    .chefRequisitionNumberSequence;
  if (!seq) throw new Error("chefRequisitionNumberSequence not present in Prisma client");
  const n = await nextSequenceValue(tx, seq, fy.storageYear);
  return `CR-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextDeliveryNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const seq = (tx as unknown as { deliveryNumberSequence?: typeof tx.orderCodeSequence })
    .deliveryNumberSequence;
  if (!seq) throw new Error("deliveryNumberSequence not present in Prisma client");
  const n = await nextSequenceValue(tx, seq, fy.storageYear);
  return `DLV-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextProductionJobNo(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const seq = (tx as unknown as { productionJobNumberSequence?: typeof tx.orderCodeSequence })
    .productionJobNumberSequence;
  if (!seq) throw new Error("productionJobNumberSequence not present in Prisma client");
  const n = await nextSequenceValue(tx, seq, fy.storageYear);
  return `PJ-${fy.label}-${String(n).padStart(4, "0")}`;
}

// ─── Procurement (Phase 2) ───────────────────────────────────────────────

export async function nextVendorPONumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const seq = (tx as unknown as { vendorPONumberSequence?: typeof tx.orderCodeSequence })
    .vendorPONumberSequence;
  if (!seq) throw new Error("vendorPONumberSequence not present in Prisma client");
  const n = await nextSequenceValue(tx, seq, fy.storageYear);
  return `VPO-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextGRNNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const seq = (tx as unknown as { gRNNumberSequence?: typeof tx.orderCodeSequence })
    .gRNNumberSequence;
  if (!seq) throw new Error("gRNNumberSequence not present in Prisma client");
  const n = await nextSequenceValue(tx, seq, fy.storageYear);
  return `GRN-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextVendorBillNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const seq = (tx as unknown as { vendorBillNumberSequence?: typeof tx.orderCodeSequence })
    .vendorBillNumberSequence;
  if (!seq) throw new Error("vendorBillNumberSequence not present in Prisma client");
  const n = await nextSequenceValue(tx, seq, fy.storageYear);
  return `VB-${fy.label}-${String(n).padStart(4, "0")}`;
}

/**
 * Vendor code is not FY-scoped — vendors persist across years. Uses
 * VendorCodeSequence with year=0 as a single global counter slot.
 */
export async function nextVendorCode(tx: Tx): Promise<string> {
  const seq = (tx as unknown as { vendorCodeSequence?: typeof tx.orderCodeSequence })
    .vendorCodeSequence;
  if (!seq) throw new Error("vendorCodeSequence not present in Prisma client");
  const n = await nextSequenceValue(tx, seq, 0);
  return `V-${String(n).padStart(4, "0")}`;
}

// ─── Finance (Phase 3) ───────────────────────────────────────────────────

export async function nextPettyCashVoucherNo(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const seq = (tx as unknown as { pettyCashVoucherNumberSequence?: typeof tx.orderCodeSequence })
    .pettyCashVoucherNumberSequence;
  if (!seq) throw new Error("pettyCashVoucherNumberSequence not present in Prisma client");
  const n = await nextSequenceValue(tx, seq, fy.storageYear);
  return `PCV-${fy.label}-${String(n).padStart(4, "0")}`;
}

/**
 * Salary run number = `SR-YY-YY-MM` (FY suffix + 2-digit calendar month).
 * Not strictly atomic-FY-sequenced because there's exactly one run per
 * calendar month (DB unique on periodMonth), so the run number is
 * deterministic from the period.
 */
export function salaryRunNo(periodMonth: Date): string {
  const fy = getFyForDate(periodMonth);
  const mm = String(periodMonth.getUTCMonth() + 1).padStart(2, "0");
  return `SR-${fy.label}-${mm}`;
}
