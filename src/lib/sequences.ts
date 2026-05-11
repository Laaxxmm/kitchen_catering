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
